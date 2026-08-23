import { openProductionDatabaseUnsafe } from "../infrastructure/unsafe/drizzle/open.js"
import { randomUUID } from "node:crypto"

import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import {
  noopObservability,
  recordProviderConfiguration,
  type Observability,
} from "@news-podcast/observability"
import { DateTime, Effect, Schema } from "effect"

import { makeCompletionPublisher } from "../adapters/messaging/completion-publisher.js"
import { makeContentArticleMaterializer } from "../adapters/rpc/content-article-materializer.js"
import { makeContentGenerationPlanner } from "../adapters/rpc/content-generation-planner.js"
import { makeFakeScriptGenerator } from "../adapters/providers/fake-script-generator.js"
import { makeIdentityScheduleClient } from "../adapters/rpc/identity-schedule-client.js"
import { makeOpenAiScriptGenerator } from "../adapters/providers/openai-script-generator.js"
import {
  makeNoopReadingTermExtractor,
  makeOpenAiReadingTermExtractor,
} from "../adapters/providers/openai-reading-term-extractor.js"
import { executionRepository } from "../adapters/persistence/execution/repository.js"
import { jobRepository } from "../adapters/persistence/job/repository.js"
import { readingDictionaryRepository } from "../adapters/persistence/reading-dictionary/repository.js"
import { makeVoicevoxSpeechSynthesizer } from "../adapters/providers/voicevox/speech-synthesizer.js"
import { relayCompletionOutbox } from "../application/completion-outbox.js"
import { createJob } from "../application/create-job.js"
import { executeEpisodeJob } from "../application/execute-job.js"
import { prepareReadingDictionary } from "../application/reading-dictionary.js"
import { runScheduledGenerationLoop } from "../application/scheduled-generation.js"
import { IdempotencyKeySchema, OwnerIdSchema } from "../domain/episode-job.js"
import { connectProductionJetStreamUnsafe } from "../infrastructure/unsafe/nats-jetstream.js"
import { connectNatsRequestUnsafe } from "../infrastructure/unsafe/nats-request.js"
import { s3AudioObjectStoreScoped } from "../infrastructure/unsafe/s3-audio-object-store.js"
import {
  currentUtcTimestampUnsafe,
  randomEpisodeIdUnsafe,
  randomJobIdUnsafe,
  randomLeaseTokenUnsafe,
  randomReadingDictionaryIdUnsafe,
} from "../infrastructure/unsafe/identity.js"
import { runCompletionRelayLoop } from "./loops/completion-relay.js"
import {
  defaultNodeCreateJobRpcDependencies,
  NodeCreateJobRpcConfigSchema,
  runProductionRpcWithDatabase,
} from "./node.js"
import {
  MAX_CANCELLATION_POLL_MILLIS,
  runEpisodeWorkerLoop,
  type EpisodeWorkerEvent,
} from "./loops/worker.js"
import {
  recordCancellationPropagation,
  recordEpisodeWorkerEvent,
  recordScriptQualityObservation,
} from "./worker-observability.js"
import { makeJobCancellationRegistry } from "./job-cancellation-registry.js"

const positive = (maximum: number) =>
  Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(maximum))
const httpUrl = Schema.String.check(
  Schema.makeFilter((value: string) => {
    try {
      const url = new URL(value)
      return ["http:", "https:"].includes(url.protocol) &&
        url.username === "" &&
        url.password === ""
        ? true
        : "expected credential-free HTTP(S) URL"
    } catch {
      return "expected HTTP(S) URL"
    }
  })
)
const secret = Schema.NonEmptyString.check(Schema.isMaxLength(4_096))
const retryPolicy = Schema.Struct({
  maximumAttempts: positive(10),
  maximumElapsedMillis: positive(300_000),
  baseDelayMillis: positive(60_000),
  maximumDelayMillis: positive(120_000),
})

export const NodeEpisodeProductionServiceConfigSchema = Schema.Struct({
  appEnvironment: Schema.Literals(["development", "test", "production"]),
  rpc: NodeCreateJobRpcConfigSchema,
  contentRequestTimeoutMillis: positive(30_000),
  providerMode: Schema.Union([Schema.Literal("fake"), Schema.Literal("live")]),
  openAi: Schema.Struct({
    apiUrl: httpUrl,
    apiKey: Schema.String.check(Schema.isMaxLength(4_096)),
    model: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
    requestTimeoutMillis: positive(300_000),
    retryPolicy,
  }),
  voicevox: Schema.Struct({
    baseUrl: httpUrl,
    characterName: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
    styleName: Schema.optional(
      Schema.NonEmptyString.check(Schema.isMaxLength(200))
    ),
    requestTimeoutMillis: positive(300_000),
    maximumAudioBytes: positive(134_217_728),
    maximumTextCharactersPerRequest: positive(10_000),
    retryPolicy,
  }),
  s3: Schema.Struct({
    endpoint: httpUrl,
    region: Schema.NonEmptyString.check(Schema.isMaxLength(100)),
    bucket: Schema.NonEmptyString.check(Schema.isMaxLength(255)),
    accessKeyId: secret,
    secretAccessKey: secret,
    requestTimeoutMillis: positive(300_000),
  }),
  worker: Schema.Struct({
    leaseMillis: positive(3_600_000),
    heartbeatMillis: positive(1_200_000),
    cancellationPollMillis: positive(MAX_CANCELLATION_POLL_MILLIS),
    retryDelayMillis: positive(3_600_000),
    idleMillis: positive(60_000),
  }).check(
    Schema.makeFilter((worker) =>
      worker.heartbeatMillis * 3 <= worker.leaseMillis
        ? true
        : "heartbeatMillis must be at most one third of leaseMillis"
    )
  ),
  completionRelay: Schema.Struct({
    batchSize: positive(100),
    intervalMillis: positive(60_000),
    initialBackoffMillis: positive(60_000),
    maximumBackoffMillis: positive(300_000),
  }),
  scheduler: Schema.Struct({
    intervalMillis: positive(3_600_000),
    failureBackoffMillis: positive(3_600_000),
    requestTimeoutMillis: positive(30_000),
  }),
}).check(
  Schema.makeFilter((config) =>
    (config.appEnvironment !== "production" ||
      config.providerMode === "live") &&
    (config.providerMode === "fake" || config.openAi.apiKey.length > 0)
      ? true
      : "production requires live provider mode with OPENAI_API_KEY"
  )
)
export type NodeEpisodeProductionServiceConfig = DeepReadonly<
  Schema.Schema.Type<typeof NodeEpisodeProductionServiceConfigSchema>
>
export const parseNodeEpisodeProductionServiceConfig = parse(
  NodeEpisodeProductionServiceConfigSchema
)

export type NodeEpisodeProductionServiceError = DeepReadonly<{
  _tag: "NodeEpisodeProductionServiceFailed"
  component: "Config" | "Content" | "Execution" | "JetStream" | "S3"
}>

export type EpisodeProductionServiceDependencies = Readonly<{
  readonly observability?: Observability
  readonly onCompletionRelayHealth?: (healthy: boolean) => void
}>

const runtimeError = (
  component: NodeEpisodeProductionServiceError["component"]
): NodeEpisodeProductionServiceError =>
  deepFreeze({ _tag: "NodeEpisodeProductionServiceFailed", component })

const addMillis = (value: DateTime.Utc, milliseconds: number) =>
  DateTime.add(value, { milliseconds })

/** Runs RPC, one fenced worker, and the completion relay in one scoped process. */
export const runNodeEpisodeProductionService = (
  input: unknown,
  onReady: () => void = () => undefined,
  dependencies: EpisodeProductionServiceDependencies = {}
): Effect.Effect<void, NodeEpisodeProductionServiceError | unknown> =>
  parseNodeEpisodeProductionServiceConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          const observability = dependencies.observability ?? noopObservability
          recordProviderConfiguration(observability, config)
          // process rootだけがDBを所有し、RPC/worker/relay/schedulerへ共有する。
          const database = yield* Effect.acquireRelease(
            Effect.try({
              try: () => openProductionDatabaseUnsafe(config.rpc.sqlitePath),
              catch: () => runtimeError("Execution"),
            }),
            (handle) => Effect.sync(() => handle.close())
          )
          const execution = yield* executionRepository(database.database).pipe(
            Effect.mapError(() => runtimeError("Execution"))
          )
          const jobs = yield* jobRepository(database.database).pipe(
            Effect.mapError(() => runtimeError("Execution"))
          )
          const dictionary = yield* readingDictionaryRepository(
            database.database
          ).pipe(Effect.mapError(() => runtimeError("Execution")))
          const content = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () => connectNatsRequestUnsafe(config.rpc.natsServers),
              catch: () => runtimeError("Content"),
            }),
            (resource) =>
              Effect.promise(() => resource.close()).pipe(Effect.ignore)
          )
          const jetStream = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                connectProductionJetStreamUnsafe(config.rpc.natsServers),
              catch: () => runtimeError("JetStream"),
            }),
            (resource) =>
              Effect.promise(() => resource.close()).pipe(Effect.ignore)
          )
          const audio = yield* s3AudioObjectStoreScoped(config.s3).pipe(
            Effect.mapError(() => runtimeError("S3"))
          )
          const controller = yield* Effect.acquireRelease(
            Effect.sync(() => new AbortController()),
            (resource) => Effect.sync(() => resource.abort())
          )
          const cancellations = makeJobCancellationRegistry()
          const now = currentUtcTimestampUnsafe
          const articles = makeContentArticleMaterializer(content, {
            newMessageId: randomUUID,
            now: () => DateTime.formatIso(now()),
            timeoutMillis: config.contentRequestTimeoutMillis,
          })
          const planning = makeContentGenerationPlanner(content, {
            newMessageId: randomUUID,
            now: () => DateTime.formatIso(now()),
            timeoutMillis: config.contentRequestTimeoutMillis,
          })
          const script =
            config.providerMode === "fake"
              ? makeFakeScriptGenerator()
              : makeOpenAiScriptGenerator(
                  {
                    ...config.openAi,
                    apiUrl: new URL(config.openAi.apiUrl),
                  },
                  {
                    observeQuality: (observation) =>
                      recordScriptQualityObservation(
                        observability,
                        observation
                      ),
                  }
                )
          const readingTerms =
            config.providerMode === "fake"
              ? makeNoopReadingTermExtractor()
              : makeOpenAiReadingTermExtractor({
                  ...config.openAi,
                  apiUrl: new URL(config.openAi.apiUrl),
                })
          const speech = makeVoicevoxSpeechSynthesizer({
            ...config.voicevox,
            baseUrl: new URL(config.voicevox.baseUrl),
          })
          const execute = executeEpisodeJob({
            planning,
            articles,
            script,
            speech,
            audio,
            dictionary: {
              prepare: (input) =>
                prepareReadingDictionary(
                  {
                    ...dictionary,
                    extractor: readingTerms,
                    nextId: randomReadingDictionaryIdUnsafe,
                    now,
                  },
                  {
                    ownerId: input.ownerId,
                    episodeJobId: input.jobId,
                    script: input.script,
                    ...(input.signal === undefined
                      ? {}
                      : { signal: input.signal }),
                  }
                ).pipe(
                  Effect.tap((result) =>
                    Effect.sync(() => {
                      if (result.addedCount > 0)
                        observability.log({
                          name: "reading_dictionary.term_added",
                          attributes: { count: result.addedCount },
                        })
                      if (result.extractionFailed)
                        observability.log({
                          name: "reading_dictionary.extraction_failed",
                          level: "warn",
                        })
                    })
                  ),
                  Effect.map(({ snapshot }) => snapshot),
                  Effect.mapError(() =>
                    deepFreeze({
                      _tag: "PipelineFailure" as const,
                      code: "sqlite_dictionary_prepare",
                      retryable: true,
                    })
                  )
                ),
            },
            persistence: execution,
            nextEpisodeId: randomEpisodeIdUnsafe,
            now,
            nextRetryAt: () => addMillis(now(), config.worker.retryDelayMillis),
          })
          const observeWorkerEvent = (event: EpisodeWorkerEvent) =>
            Effect.gen(function* () {
              yield* Effect.sync(() => {
                recordEpisodeWorkerEvent(observability, event)
              })
              const snapshot = yield* jobs.statusSnapshot().pipe(
                Effect.matchEffect({
                  onFailure: () => Effect.succeed([] as const),
                  onSuccess: (value) => Effect.succeed(value),
                })
              )
              yield* Effect.sync(() => {
                for (const state of snapshot)
                  observability.gauge("episode.jobs", state.count, {
                    "job.status": state.status,
                  })
                const oldest = snapshot
                  .map((state) => state.oldestActiveAt)
                  .filter((value): value is string => value !== undefined)
                  .sort()[0]
                observability.gauge(
                  "episode.queue.oldest.age",
                  oldest === undefined
                    ? 0
                    : Math.max(
                        0,
                        Date.parse(DateTime.formatIso(now())) -
                          Date.parse(oldest)
                      )
                )
              })
              yield* Effect.logInfo("episode worker state", {
                event_name: event._tag,
              })
            })
          const worker = runEpisodeWorkerLoop(
            {
              leaseNext: execution.leaseNext,
              renewLease: execution.renewLease,
              checkCancellation: execution.checkCancellation,
              subscribeCancellation: cancellations.subscribe,
              execute,
              now,
              leasedUntil: (instant) =>
                addMillis(instant, config.worker.leaseMillis),
              nextLeaseToken: randomLeaseTokenUnsafe,
              heartbeatMillis: config.worker.heartbeatMillis,
              cancellationPollMillis: config.worker.cancellationPollMillis,
              backoffMillis: () => config.worker.idleMillis,
              wait: (delay) => Effect.sleep(delay),
              observe: observeWorkerEvent,
              recordCancellationPropagation: (event) =>
                recordCancellationPropagation(observability, event),
            },
            controller.signal
          ).pipe(Effect.mapError(() => runtimeError("Execution")))
          const relay = runCompletionRelayLoop(
            {
              relay: () =>
                relayCompletionOutbox(
                  {
                    listPending: execution.listPendingCompletionOutbox,
                    publish: makeCompletionPublisher(jetStream),
                    markPublished: execution.markCompletionPublished,
                    now,
                  },
                  config.completionRelay.batchSize
                ),
              wait: (delay) => Effect.sleep(delay),
              observe: (event) =>
                Effect.logInfo("completion relay state", {
                  event_name: event._tag,
                }),
              setHealthy: dependencies.onCompletionRelayHealth,
            },
            config.completionRelay
          )
          const identitySchedule = makeIdentityScheduleClient(content, {
            now: () => DateTime.formatIso(now()),
            timeoutMillis: config.scheduler.requestTimeoutMillis,
          })
          const createScheduled = createJob({
            nextJobId: Effect.sync(randomJobIdUnsafe),
            now: Effect.sync(now),
            saveIdempotently: jobs.saveScheduledIdempotently,
          })
          const scheduler = runScheduledGenerationLoop(
            {
              discoverDue: identitySchedule.discoverDue,
              create: (ownerId, idempotencyKey) =>
                Effect.all([
                  parse(OwnerIdSchema)(ownerId),
                  parse(IdempotencyKeySchema)(idempotencyKey),
                ]).pipe(
                  Effect.flatMap(([parsedOwnerId, parsedIdempotencyKey]) =>
                    createScheduled({
                      ownerId: parsedOwnerId,
                      idempotencyKey: parsedIdempotencyKey,
                      trigger: "scheduled",
                    })
                  )
                ),
              complete: identitySchedule.complete,
              wait: (delay) => Effect.sleep(delay),
              observe: (event) =>
                Effect.sync(() =>
                  observability.count("episode.schedule.outcomes", 1, {
                    "schedule.outcome": event._tag.toLowerCase(),
                  })
                ).pipe(
                  Effect.andThen(
                    Effect.logInfo("scheduled generation state", {
                      event_name: event._tag,
                      owner_id: event.ownerId,
                      local_date: event.localDate,
                    })
                  )
                ),
            },
            config.scheduler,
            controller.signal
          )
          const rpc = runProductionRpcWithDatabase(
            config.rpc,
            database.database,
            {
              ...defaultNodeCreateJobRpcDependencies,
              onReady,
              onJobCanceled: (job) =>
                void cancellations.notify(job.jobId, job.canceledAt),
            }
          ).pipe(Effect.mapError(() => runtimeError("Execution")))

          yield* Effect.all([rpc, worker, relay, scheduler], {
            concurrency: "unbounded",
            discard: true,
          })
        })
      )
    )
  )
