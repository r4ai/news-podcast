import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  createArticleCatalog,
  createArticleLibrary,
  createArchiveStore,
  createContentTaxonomy as createContentTaxonomyRepository,
  createEnrichmentQueue,
  createFeedSyncQueue,
  createInterestProfileRepository,
  createSubscriptionRepository,
  makeOpenAiEnrichmentProvider,
  type ArchiveStore,
} from "../adapters/index.js"
import type { ArticleCatalog } from "../application/ports/article-catalog.js"
import type { ArticleLibraryRepository } from "../application/article-library.js"
import {
  createEnrichmentOperations,
  type EnrichmentProvider,
  type EnrichmentSource,
} from "../application/enrichment.js"
import { createContentTaxonomy } from "../application/content-taxonomy.js"
import { createGenerationPlanning } from "../application/generation-planning.js"
import { createInterestProfileOperations } from "../application/interest-profile.js"
import type { SubscriptionRepository } from "../application/ports/subscription.js"
import type { FeedSyncQueueRepository } from "../application/feed-sync-queue.js"
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
  randomSnapshotIdUnsafe,
  randomSyncJobIdUnsafe,
  randomTagIdUnsafe,
} from "../infrastructure/unsafe/identity.js"
import {
  parseJsonUnsafe,
  stringifyJsonUnsafe,
} from "../infrastructure/unsafe/json.js"
import {
  openContentKnowledgeDatabaseUnsafe,
  type ContentKnowledgeDatabaseHandle,
} from "../infrastructure/unsafe/drizzle/open.js"
import { runContentFeedPoller } from "./loops/feed-poller.js"
import { makeArticleLibraryHandler } from "./rpc/article-library-handler.js"
import { runNatsContentKnowledgeRpc } from "./rpc/nats-server.js"
import {
  makeEnrichmentSource,
  unavailableEnrichmentProvider,
} from "./enrichment.js"
import { runEnrichmentWorkerLoop } from "./loops/enrichment-worker.js"
import { makeFeedPollWakeup } from "./loops/feed-poll.js"
import { makeOpenAiArticleSelector } from "../adapters/providers/generation-planning/openai/selector.js"

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

const LoopDelaySchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(300_000)
)
const PositiveBytesSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(10 * 1_024 * 1_024)
)
const AssetBytesSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(100 * 1_024 * 1_024)
)
const DailyLimitSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(10_000)
)
const S3TextSchema = Schema.NonEmptyString.check(Schema.isMaxLength(1_024))
const HttpEndpointSchema = Schema.String.check(
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
)
const ProviderAttemptSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(5)
)
export const NodeServiceConfigSchema = Schema.Struct({
  sqlitePath: SqlitePathSchema,
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
  rpc: Schema.Struct({
    queueGroup: Schema.NonEmptyString.check(
      Schema.isPattern(/^[a-z][a-z0-9-]{0,62}$/)
    ),
  }),
  feedPoller: Schema.Struct({
    http: Schema.Struct({
      timeoutMillis: LoopDelaySchema,
      maximumBytes: PositiveBytesSchema,
    }),
    loop: Schema.Struct({
      intervalMillis: LoopDelaySchema,
      initialBackoffMillis: LoopDelaySchema,
      maximumBackoffMillis: LoopDelaySchema,
    }),
  }),
  enrichment: Schema.Struct({
    dailyLimit: DailyLimitSchema,
    provider: Schema.NullOr(
      Schema.Struct({
        apiUrl: HttpEndpointSchema,
        apiKey: S3TextSchema,
        model: S3TextSchema,
        requestTimeoutMillis: LoopDelaySchema,
        maximumAttempts: ProviderAttemptSchema,
        baseDelayMillis: LoopDelaySchema,
        maximumDelayMillis: LoopDelaySchema,
      })
    ),
    loop: Schema.Struct({
      intervalMillis: LoopDelaySchema,
      initialBackoffMillis: LoopDelaySchema,
      maximumBackoffMillis: LoopDelaySchema,
    }),
  }),
  archive: Schema.Struct({
    endpoint: HttpEndpointSchema,
    region: S3TextSchema,
    bucket: S3TextSchema,
    accessKeyId: S3TextSchema,
    secretAccessKey: S3TextSchema,
    timeoutMillis: LoopDelaySchema,
    maximumHtmlBytes: PositiveBytesSchema,
    maximumAssetBytes: AssetBytesSchema,
    maximumAssetCount: Schema.Int.check(
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(512)
    ),
    maximumAssetTotalBytes: AssetBytesSchema,
  }),
})
const parseNodeServiceStructure = parse(NodeServiceConfigSchema)
export const parseNodeServiceConfig = (input: unknown) =>
  parseNodeServiceStructure(input).pipe(
    Effect.filterOrFail(
      (config) =>
        config.feedPoller.loop.initialBackoffMillis <=
          config.feedPoller.loop.maximumBackoffMillis &&
        config.enrichment.loop.initialBackoffMillis <=
          config.enrichment.loop.maximumBackoffMillis &&
        (config.enrichment.provider === null ||
          config.enrichment.provider.baseDelayMillis <=
            config.enrichment.provider.maximumDelayMillis),
      () => deepFreeze({ _tag: "InvalidBackoffRange" as const })
    )
  )

export type NodeRuntimeError = DeepReadonly<{
  readonly _tag: "ContentKnowledgeRuntimeFailed"
  readonly component: "Config" | "Nats" | "ObjectStore" | "Sqlite"
}>

export type NodeContentKnowledgeRuntime = DeepReadonly<{
  readonly store: ArchiveStore
  readonly articles: ArticleCatalog
  readonly library: ArticleLibraryRepository
  readonly subscriptions: SubscriptionRepository
  readonly feedSyncQueue: FeedSyncQueueRepository
  readonly taxonomy: ReturnType<typeof createContentTaxonomy>
  readonly interestProfiles: ReturnType<typeof createInterestProfileOperations>
  readonly createEnrichment: (input: {
    readonly source: EnrichmentSource
    readonly provider: EnrichmentProvider
    readonly dailyLimit: number
  }) => ReturnType<typeof createEnrichmentOperations>
  readonly close: () => Effect.Effect<void, NodeRuntimeError>
}>

export type NodeRuntimeDependencies = DeepReadonly<{
  readonly openDatabase: (path: string) => ContentKnowledgeDatabaseHandle
  readonly newJobId: () => string
  readonly now: () => CapturedAt
  readonly newTagId: typeof randomTagIdUnsafe
  readonly newEnrichmentLeaseToken: typeof randomEnrichmentLeaseTokenUnsafe
}>

export type NodeServiceDependencies = Readonly<{
  readonly startRuntime: (
    input: unknown
  ) => Effect.Effect<NodeContentKnowledgeRuntime, NodeRuntimeError>
  readonly openCapture: (
    config: HttpS3ArticleCaptureConfig
  ) => HttpS3ArticleCaptureResource
  readonly openMarkdownReader: typeof openS3MarkdownObjectReaderUnsafe
  readonly runRpc: typeof runNatsContentKnowledgeRpc
  readonly runPoller: typeof runContentFeedPoller
  readonly enrichmentProvider?: EnrichmentProvider
  readonly runEnrichment: typeof runEnrichmentWorkerLoop
  readonly onReady?: () => void
}>

const defaultDependencies: NodeRuntimeDependencies = deepFreeze({
  openDatabase: openContentKnowledgeDatabaseUnsafe,
  newJobId: randomSyncJobIdUnsafe,
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

const closeDatabase = (
  handle: ContentKnowledgeDatabaseHandle
): Effect.Effect<void, NodeRuntimeError> =>
  Effect.try({
    try: () => handle.close(),
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
        try: () => dependencies.openDatabase(config.sqlitePath),
        catch: () => runtimeError("Sqlite"),
      }).pipe(
        Effect.flatMap((handle) =>
          createArchiveStore(handle.database, jsonInterop).pipe(
            Effect.mapError(() => runtimeError("Sqlite")),
            Effect.flatMap((store) =>
              Effect.all([
                createArticleCatalog(handle.database, jsonInterop),
                createArticleLibrary(handle.database),
                createSubscriptionRepository(handle.database),
                createContentTaxonomyRepository(handle.database),
                createEnrichmentQueue(handle.database),
                createFeedSyncQueue(handle.database, dependencies.newJobId),
                createInterestProfileRepository(
                  handle.database,
                  dependencies.now
                ),
              ]).pipe(
                Effect.mapError(() => runtimeError("Sqlite")),
                Effect.map(
                  ([
                    articles,
                    library,
                    subscriptions,
                    taxonomyRepository,
                    enrichmentQueue,
                    feedSyncQueue,
                    interestProfileRepository,
                  ]) => {
                    const taxonomy = createContentTaxonomy({
                      repository: taxonomyRepository,
                      newTagId: dependencies.newTagId,
                      now: dependencies.now,
                    })
                    const interestProfiles = createInterestProfileOperations(
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
                    const close = () => closeDatabase(handle)

                    return deepFreeze({
                      store,
                      articles,
                      library,
                      subscriptions,
                      feedSyncQueue,
                      taxonomy,
                      interestProfiles,
                      createEnrichment,
                      close,
                    })
                  }
                )
              )
            ),
            Effect.tapError(() => closeDatabase(handle).pipe(Effect.ignore))
          )
        )
      )
    )
  )

export const defaultNodeServiceDependencies: NodeServiceDependencies =
  Object.freeze({
    startRuntime: startNodeRuntime,
    openCapture: openHttpS3ArticleCaptureUnsafe,
    openMarkdownReader: openS3MarkdownObjectReaderUnsafe,
    runRpc: runNatsContentKnowledgeRpc,
    runPoller: runContentFeedPoller,
    runEnrichment: runEnrichmentWorkerLoop,
  })

/** Owns the continuously running RPC and worker resources. */
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
                    const feedPollWakeup = makeFeedPollWakeup()
                    const enrichment = runtime.createEnrichment({
                      source: makeEnrichmentSource(markdown.reader),
                      provider:
                        dependencies.enrichmentProvider ??
                        (config.enrichment.provider === null
                          ? unavailableEnrichmentProvider
                          : makeOpenAiEnrichmentProvider({
                              ...config.enrichment.provider,
                              apiUrl: new URL(
                                config.enrichment.provider.apiUrl
                              ),
                            })),
                      dailyLimit: config.enrichment.dailyLimit,
                    })
                    const generationPlanning = createGenerationPlanning({
                      catalog: runtime.articles,
                      interestProfiles: runtime.interestProfiles,
                      selector:
                        config.enrichment.provider === null
                          ? deepFreeze({
                              model: "unavailable",
                              select: () =>
                                Effect.fail(
                                  deepFreeze({
                                    _tag: "ArticleSelectionFailed" as const,
                                    reason: "ProviderFailure" as const,
                                  })
                                ),
                            })
                          : makeOpenAiArticleSelector({
                              apiUrl: new URL(
                                config.enrichment.provider.apiUrl
                              ),
                              apiKey: config.enrichment.provider.apiKey,
                              model: config.enrichment.provider.model,
                              requestTimeoutMillis:
                                config.enrichment.provider.requestTimeoutMillis,
                            }),
                    })
                    return Effect.all(
                      [
                        dependencies.runRpc(
                          {
                            natsServers: config.natsServers,
                            queueGroup: config.rpc.queueGroup,
                            onReady: dependencies.onReady,
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
                          },
                          generationPlanning,
                          feedPollWakeup
                        ),
                        dependencies.runPoller(
                          config.feedPoller,
                          runtime,
                          capture,
                          undefined,
                          feedPollWakeup
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
