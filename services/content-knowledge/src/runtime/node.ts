import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  createJetStreamPublisher,
  createSqliteArticleCatalog,
  createSqliteArticleLibrary,
  createSqliteArchiveStore,
  createSqliteContentTaxonomy,
  createSqliteEnrichmentQueue,
  createSqliteInterestProfileRepository,
  createSqliteSubscriptionRepository,
  OutboxBatchSizeSchema,
  parseOutboxLimit,
  relayOutbox,
  type OutboxPublisherError,
  type OutboxStoreError,
  type RelayResult,
  type SqlitePort,
  type SqliteArchiveStore,
} from "../adapters/index.js"
import type { ArticleCatalog } from "../application/article-catalog-ports.js"
import type { ArticleLibraryRepository } from "../application/article-library.js"
import {
  createEnrichmentOperations,
  type EnrichmentProvider,
  type EnrichmentSource,
} from "../application/enrichment.js"
import { createContentTaxonomy } from "../application/content-taxonomy.js"
import { createInterestProfileOperations } from "../application/interest-profile.js"
import type { SubscriptionRepository } from "../application/subscription-ports.js"
import { archiveArticle } from "../application/archive-article.js"
import {
  openHttpS3ArticleCaptureUnsafe,
  type HttpS3ArticleCaptureConfig,
  type HttpS3ArticleCaptureResource,
} from "../infrastructure/unsafe/http-s3-article-capture.js"
import { openS3MarkdownObjectReaderUnsafe } from "../infrastructure/unsafe/s3-markdown-object-reader.js"
import type { CapturedAt } from "../domain/article.js"
import {
  currentCapturedAtUnsafe,
  deriveManualArchiveRequestIdUnsafe,
  randomEnrichmentLeaseTokenUnsafe,
  randomMessageIdUnsafe,
  randomSnapshotIdUnsafe,
  randomTagIdUnsafe,
} from "../infrastructure/unsafe/identity.js"
import {
  connectJetStreamUnsafe,
  type UnsafeJetStream,
} from "../infrastructure/unsafe/nats-jetstream.js"
import {
  parseJsonUnsafe,
  stringifyJsonUnsafe,
} from "../infrastructure/unsafe/json.js"
import { openSqliteUnsafe } from "../infrastructure/unsafe/sqlite.js"
import { runContentFeedPoller } from "./content-feed-poller.js"
import { makeArticleLibraryHandler } from "./article-library-handler.js"
import { runNatsContentKnowledgeRpc } from "./nats-content-knowledge-rpc.js"
import {
  runOutboxRelayLoop,
  type OutboxRelayLoopRuntime,
} from "./outbox-relay-loop.js"
import {
  makeEnrichmentSource,
  unavailableEnrichmentProvider,
} from "./enrichment-runtime.js"
import { runEnrichmentWorkerLoop } from "./enrichment-worker-loop.js"

const SqlitePathSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(4_096)
).pipe(Schema.brand("SqlitePath"))

const NatsServerSchema = Schema.String.check(
  Schema.isPattern(/^nats:\/\/[\w.-]+(?::\d{1,5})?$/)
).pipe(Schema.brand("NatsServer"))

export const NodeRuntimeConfigSchema = Schema.Struct({
  sqlitePath: SqlitePathSchema,
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
})
export const parseNodeRuntimeConfig = parse(NodeRuntimeConfigSchema)

const RelayDelaySchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(300_000)
)
const PositiveBytesSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(10 * 1_024 * 1_024)
)
const DailyLimitSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(10_000)
)
const S3TextSchema = Schema.NonEmptyString.check(Schema.isMaxLength(1_024))
export const NodeServiceConfigSchema = Schema.Struct({
  sqlitePath: SqlitePathSchema,
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
  relay: Schema.Struct({
    batchSize: OutboxBatchSizeSchema,
    intervalMillis: RelayDelaySchema,
    initialBackoffMillis: RelayDelaySchema,
    maximumBackoffMillis: RelayDelaySchema,
  }),
  rpc: Schema.Struct({
    queueGroup: Schema.NonEmptyString.check(
      Schema.isPattern(/^[a-z][a-z0-9-]{0,62}$/)
    ),
  }),
  feedPoller: Schema.Struct({
    http: Schema.Struct({
      timeoutMillis: RelayDelaySchema,
      maximumBytes: PositiveBytesSchema,
    }),
    loop: Schema.Struct({
      intervalMillis: RelayDelaySchema,
      initialBackoffMillis: RelayDelaySchema,
      maximumBackoffMillis: RelayDelaySchema,
    }),
  }),
  enrichment: Schema.Struct({
    dailyLimit: DailyLimitSchema,
    loop: Schema.Struct({
      intervalMillis: RelayDelaySchema,
      initialBackoffMillis: RelayDelaySchema,
      maximumBackoffMillis: RelayDelaySchema,
    }),
  }),
  archive: Schema.Struct({
    endpoint: Schema.String.check(
      Schema.makeFilter((value: string) => {
        try {
          const url = new URL(value)
          return (
            (url.protocol === "http:" || url.protocol === "https:") &&
            url.username === "" &&
            url.password === ""
          )
        } catch {
          return false
        }
      })
    ),
    region: S3TextSchema,
    bucket: S3TextSchema,
    accessKeyId: S3TextSchema,
    secretAccessKey: S3TextSchema,
    timeoutMillis: RelayDelaySchema,
    maximumHtmlBytes: PositiveBytesSchema,
  }),
})
const parseNodeServiceStructure = parse(NodeServiceConfigSchema)
export const parseNodeServiceConfig = (input: unknown) =>
  parseNodeServiceStructure(input).pipe(
    Effect.filterOrFail(
      (config) =>
        config.relay.initialBackoffMillis <=
          config.relay.maximumBackoffMillis &&
        config.feedPoller.loop.initialBackoffMillis <=
          config.feedPoller.loop.maximumBackoffMillis &&
        config.enrichment.loop.initialBackoffMillis <=
          config.enrichment.loop.maximumBackoffMillis,
      () => deepFreeze({ _tag: "InvalidBackoffRange" as const })
    )
  )

export type NodeRuntimeError = DeepReadonly<{
  readonly _tag: "ContentKnowledgeRuntimeFailed"
  readonly component: "Config" | "Nats" | "ObjectStore" | "Outbox" | "Sqlite"
}>

export type NodeContentKnowledgeRuntime = DeepReadonly<{
  readonly store: SqliteArchiveStore
  readonly articles: ArticleCatalog
  readonly library: ArticleLibraryRepository
  readonly subscriptions: SubscriptionRepository
  readonly taxonomy: ReturnType<typeof createContentTaxonomy>
  readonly interestProfiles: ReturnType<typeof createInterestProfileOperations>
  readonly createEnrichment: (input: {
    readonly source: EnrichmentSource
    readonly provider: EnrichmentProvider
    readonly dailyLimit: number
  }) => ReturnType<typeof createEnrichmentOperations>
  readonly relayOnce: (
    input: unknown
  ) => Effect.Effect<
    RelayResult,
    NodeRuntimeError | OutboxPublisherError | OutboxStoreError
  >
  readonly close: () => Effect.Effect<void, NodeRuntimeError>
}>

export type NodeRuntimeDependencies = DeepReadonly<{
  readonly openSqlite: (path: string) => SqlitePort
  readonly connectJetStream: (
    servers: readonly string[]
  ) => Promise<UnsafeJetStream>
  readonly newMessageId: typeof randomMessageIdUnsafe
  readonly now: () => CapturedAt
  readonly newTagId: typeof randomTagIdUnsafe
  readonly newEnrichmentLeaseToken: typeof randomEnrichmentLeaseTokenUnsafe
}>

export type NodeServiceDependencies = Readonly<{
  readonly startRuntime: (
    input: unknown
  ) => Effect.Effect<NodeContentKnowledgeRuntime, NodeRuntimeError>
  readonly relayRuntime: Partial<OutboxRelayLoopRuntime>
  readonly openCapture: (
    config: HttpS3ArticleCaptureConfig
  ) => HttpS3ArticleCaptureResource
  readonly openMarkdownReader: typeof openS3MarkdownObjectReaderUnsafe
  readonly runRpc: typeof runNatsContentKnowledgeRpc
  readonly runPoller: typeof runContentFeedPoller
  readonly enrichmentProvider: EnrichmentProvider
  readonly runEnrichment: typeof runEnrichmentWorkerLoop
  readonly onReady?: () => void
}>

const defaultDependencies: NodeRuntimeDependencies = deepFreeze({
  openSqlite: openSqliteUnsafe,
  connectJetStream: connectJetStreamUnsafe,
  newMessageId: randomMessageIdUnsafe,
  now: currentCapturedAtUnsafe,
  newTagId: randomTagIdUnsafe,
  newEnrichmentLeaseToken: randomEnrichmentLeaseTokenUnsafe,
})
const jsonInterop = deepFreeze({
  parse: parseJsonUnsafe,
  stringify: stringifyJsonUnsafe,
})

const runtimeError = (
  component: NodeRuntimeError["component"]
): NodeRuntimeError =>
  deepFreeze({ _tag: "ContentKnowledgeRuntimeFailed" as const, component })

const closeSqlite = (
  database: SqlitePort
): Effect.Effect<void, NodeRuntimeError> =>
  Effect.try({
    try: () => database.close(),
    catch: () => runtimeError("Sqlite"),
  })

export const startNodeRuntime = (
  input: unknown,
  dependencies: NodeRuntimeDependencies = defaultDependencies
): Effect.Effect<NodeContentKnowledgeRuntime, NodeRuntimeError> =>
  parseNodeRuntimeConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.try({
        try: () => dependencies.openSqlite(config.sqlitePath),
        catch: () => runtimeError("Sqlite"),
      }).pipe(
        Effect.flatMap((database) =>
          createSqliteArchiveStore(
            database,
            dependencies.newMessageId,
            jsonInterop
          ).pipe(
            Effect.mapError(() => runtimeError("Sqlite")),
            Effect.flatMap((store) =>
              Effect.all([
                createSqliteArticleCatalog(database, jsonInterop),
                createSqliteArticleLibrary(database),
                createSqliteSubscriptionRepository(database),
                createSqliteContentTaxonomy(database),
                createSqliteEnrichmentQueue(database),
                createSqliteInterestProfileRepository(
                  database,
                  dependencies.now
                ),
              ]).pipe(
                Effect.mapError(() => runtimeError("Sqlite")),
                Effect.flatMap(
                  ([
                    articles,
                    library,
                    subscriptions,
                    taxonomyRepository,
                    enrichmentQueue,
                    interestProfileRepository,
                  ]) =>
                    Effect.tryPromise({
                      try: () =>
                        dependencies.connectJetStream(config.natsServers),
                      catch: () => runtimeError("Nats"),
                    }).pipe(
                      Effect.map((jetStream) => {
                        const publisher = createJetStreamPublisher(jetStream)
                        const relay = relayOutbox({
                          store,
                          publisher,
                          now: dependencies.now,
                        })
                        const relayOnce = (batchSize: unknown) =>
                          parseOutboxLimit(batchSize).pipe(
                            Effect.mapError(() => runtimeError("Outbox")),
                            Effect.flatMap(relay)
                          )
                        const taxonomy = createContentTaxonomy({
                          repository: taxonomyRepository,
                          newTagId: dependencies.newTagId,
                          now: dependencies.now,
                        })
                        const interestProfiles =
                          createInterestProfileOperations(
                            interestProfileRepository
                          )
                        const createEnrichment = (input: {
                          readonly source: EnrichmentSource
                          readonly provider: EnrichmentProvider
                          readonly dailyLimit: number
                        }) =>
                          createEnrichmentOperations({
                            queue: enrichmentQueue,
                            taxonomy: taxonomyRepository,
                            interestProfiles,
                            source: input.source,
                            provider: input.provider,
                            dailyLimit: input.dailyLimit,
                            now: dependencies.now,
                            newLeaseToken: dependencies.newEnrichmentLeaseToken,
                          })
                        const close = () =>
                          Effect.tryPromise({
                            try: () => jetStream.close(),
                            catch: () => runtimeError("Nats"),
                          }).pipe(
                            Effect.matchEffect({
                              onFailure: (natsError) =>
                                closeSqlite(database).pipe(
                                  Effect.matchEffect({
                                    onFailure: () => Effect.fail(natsError),
                                    onSuccess: () => Effect.fail(natsError),
                                  })
                                ),
                              onSuccess: () => closeSqlite(database),
                            })
                          )

                        return deepFreeze({
                          store,
                          articles,
                          library,
                          subscriptions,
                          taxonomy,
                          interestProfiles,
                          createEnrichment,
                          relayOnce,
                          close,
                        })
                      })
                    )
                )
              )
            ),
            Effect.tapError(() => closeSqlite(database).pipe(Effect.ignore))
          )
        )
      )
    )
  )

export const defaultNodeServiceDependencies: NodeServiceDependencies =
  Object.freeze({
    startRuntime: startNodeRuntime,
    relayRuntime: Object.freeze({}),
    openCapture: openHttpS3ArticleCaptureUnsafe,
    openMarkdownReader: openS3MarkdownObjectReaderUnsafe,
    runRpc: runNatsContentKnowledgeRpc,
    runPoller: runContentFeedPoller,
    enrichmentProvider: unavailableEnrichmentProvider,
    runEnrichment: runEnrichmentWorkerLoop,
  })

/** Owns the continuously running relay and releases SQLite/NATS on interruption. */
export const runNodeService = (
  input: unknown,
  dependencies: NodeServiceDependencies = defaultNodeServiceDependencies
): Effect.Effect<void, NodeRuntimeError> =>
  parseNodeServiceConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.acquireRelease(
          dependencies.startRuntime({
            sqlitePath: config.sqlitePath,
            natsServers: config.natsServers,
          }),
          (runtime) =>
            runtime.close().pipe(
              Effect.tapError((failure) =>
                Effect.logWarning("content runtime close failed", {
                  event_name: "content.runtime.close",
                  component: failure.component,
                })
              ),
              Effect.ignore
            )
        ).pipe(
          Effect.flatMap((runtime) =>
            Effect.acquireRelease(
              Effect.try({
                try: () => dependencies.openCapture(config.archive),
                catch: () => runtimeError("ObjectStore"),
              }),
              (capture) => capture.close
            ).pipe(
              Effect.flatMap((capture) =>
                Effect.acquireRelease(
                  Effect.try({
                    try: () => dependencies.openMarkdownReader(config.archive),
                    catch: () => runtimeError("ObjectStore"),
                  }),
                  (markdown) => markdown.close
                ).pipe(
                  Effect.flatMap((markdown) => {
                    const enrichment = runtime.createEnrichment({
                      source: makeEnrichmentSource(markdown.reader),
                      provider: dependencies.enrichmentProvider,
                      dailyLimit: config.enrichment.dailyLimit,
                    })
                    dependencies.onReady?.()
                    return Effect.all(
                      [
                        runOutboxRelayLoop(
                          config.relay,
                          runtime.relayOnce,
                          dependencies.relayRuntime
                        ),
                        dependencies.runRpc(
                          {
                            natsServers: config.natsServers,
                            queueGroup: config.rpc.queueGroup,
                          },
                          runtime,
                          markdown.reader,
                          undefined,
                          makeArticleLibraryHandler({
                            articles: runtime.library,
                            objects: markdown.reader,
                            now: currentCapturedAtUnsafe,
                            deriveArchiveRequestId:
                              deriveManualArchiveRequestIdUnsafe,
                            archive: archiveArticle({
                              ...runtime.store,
                              capture: capture.capture,
                              newSnapshotId: randomSnapshotIdUnsafe,
                              now: currentCapturedAtUnsafe,
                            }),
                          }),
                          {
                            taxonomy: runtime.taxonomy,
                            interestProfiles: runtime.interestProfiles,
                            enrichment,
                          }
                        ),
                        dependencies.runPoller(
                          config.feedPoller,
                          runtime,
                          capture
                        ),
                        dependencies.runEnrichment(
                          config.enrichment.loop,
                          enrichment.runCycle
                        ),
                      ],
                      { concurrency: "unbounded", discard: true }
                    )
                  })
                )
              )
            )
          )
        )
      )
    )
  )
