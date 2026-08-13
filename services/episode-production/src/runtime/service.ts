import { randomUUID } from "node:crypto"

import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import {
  noopObservability,
  type Observability,
} from "@news-podcast/observability"
import { DateTime, Effect, Schema } from "effect"

import { makeCompletionPublisher } from "../adapters/completion-publisher.js"
import { makeContentArticleMaterializer } from "../adapters/content-article-materializer.js"
import { makeIdentityScheduleClient } from "../adapters/identity-schedule-client.js"
import { makeOpenAiScriptGenerator } from "../adapters/openai-script-generator.js"
import { sqliteExecutionRepository } from "../adapters/sqlite-execution-repository.js"
import { sqliteJobRepository } from "../adapters/sqlite-job-repository.js"
import { sqliteReadingDictionaryRepository } from "../adapters/sqlite-reading-dictionary.js"
import { makeVoicevoxSpeechSynthesizer } from "../adapters/voicevox-speech-synthesizer.js"
import { relayCompletionOutbox } from "../application/completion-outbox.js"
import { createJob } from "../application/create-job.js"
import { executeEpisodeJob } from "../application/execute-job.js"
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
} from "../infrastructure/unsafe/identity.js"
import { runCompletionRelayLoop } from "./completion-relay-loop.js"
import { NodeCreateJobRpcConfigSchema, runNodeProductionRpc } from "./node.js"
import {
  runEpisodeWorkerLoop,
  type EpisodeWorkerEvent,
} from "./worker-loop.js"

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
  rpc: NodeCreateJobRpcConfigSchema,
  contentRequestTimeoutMillis: positive(30_000),
  openAi: Schema.Struct({
    endpoint: httpUrl,
    apiKey: secret,
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
})
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
          const observability =
            dependencies.observability ?? noopObservability
          const execution = yield* sqliteExecutionRepository(
            config.rpc.sqlitePath
          ).pipe(Effect.mapError(() => runtimeError("Execution")))
          const jobs = yield* sqliteJobRepository(config.rpc.sqlitePath).pipe(
            Effect.mapError(() => runtimeError("Execution"))
          )
          const dictionary = yield* sqliteReadingDictionaryRepository(
            config.rpc.sqlitePath
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
          const now = currentUtcTimestampUnsafe
          const articles = makeContentArticleMaterializer(content, {
            newMessageId: randomUUID,
            now: () => DateTime.formatIso(now()),
            timeoutMillis: config.contentRequestTimeoutMillis,
          })
          const script = makeOpenAiScriptGenerator({
            ...config.openAi,
            endpoint: new URL(config.openAi.endpoint),
          })
          const speech = makeVoicevoxSpeechSynthesizer({
            ...config.voicevox,
            baseUrl: new URL(config.voicevox.baseUrl),
          })
          const execute = executeEpisodeJob({
            articles,
            script,
            speech,
            audio,
            dictionary: {
              capture: (ownerId) =>
                dictionary.captureSnapshot(ownerId).pipe(
                  Effect.mapError(() =>
                    deepFreeze({
                      _tag: "PipelineFailure" as const,
                      code: "sqlite_dictionary_snapshot",
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
                switch (event._tag) {
                  case "JobLeased":
                    observability.count("episode.started", 1, {
                      "job.attempt": event.attempt,
                    })
                    if (event.recovered)
                      observability.count("episode.lease.recovered")
                    break
                  case "JobFinished":
                    if (event.outcome === "Succeeded")
                      observability.count("episode.succeeded")
                    if (event.outcome === "Retrying")
                      observability.count("episode.retry")
                    if (event.outcome === "Failed")
                      observability.count("episode.failed")
                    if (event.outcome === "Canceled")
                      observability.count("episode.canceled")
                    if (event.outcome === "StaleLease")
                      observability.count("episode.lease.lost")
                    break
                  case "WorkerFailed":
                    observability.count("process.error", 1, {
                      "failure.code": event.code,
                      "operation.stage": event.stage,
                    })
                    break
                }
              })
              const snapshot = yield* jobs
                .statusSnapshot()
                .pipe(
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
                        Date.parse(DateTime.formatIso(now())) - Date.parse(oldest)
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
              execute,
              now,
              leasedUntil: (instant) =>
                addMillis(instant, config.worker.leaseMillis),
              nextLeaseToken: randomLeaseTokenUnsafe,
              heartbeatMillis: config.worker.heartbeatMillis,
              backoffMillis: () => config.worker.idleMillis,
              wait: (delay) => Effect.sleep(delay),
              observe: observeWorkerEvent,
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
            saveIdempotently: jobs.saveIdempotently,
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
                  ),
                  Effect.asVoid
                ),
              complete: identitySchedule.complete,
              wait: (delay) => Effect.sleep(delay),
              observe: (event) =>
                Effect.logInfo("scheduled generation state", {
                  event_name: event._tag,
                  owner_id: event.ownerId,
                  local_date: event.localDate,
                }),
            },
            config.scheduler,
            controller.signal
          )
          const rpc = runNodeProductionRpc(config.rpc).pipe(
            Effect.mapError(() => runtimeError("Execution"))
          )

          onReady()

          yield* Effect.all([rpc, worker, relay, scheduler], {
            concurrency: "unbounded",
            discard: true,
          })
        })
      )
    )
  )
