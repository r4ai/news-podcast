import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import { parseCompletedEpisode } from "../adapters/parse-stored-episode.js"
import type { EpisodeCompletionPorts } from "../application/completion-ports.js"
import type { AudioAccessSigner } from "../application/ports.js"
import {
  connectEpisodeCompletedConsumerUnsafe,
  makeSqliteEpisodeRepository,
  openS3AudioAccessSignerUnsafe,
  type S3AudioAccessSignerConfig,
  type S3AudioAccessSignerResource,
  type SqliteEpisodeRepository,
  type UnsafeEpisodeCompletedConsumer,
} from "../infrastructure/index.js"
import {
  currentEpochMillisUnsafe,
  currentUtcInstantUnsafe,
  randomMessageIdUnsafe,
} from "../infrastructure/unsafe/identity.js"
import {
  connectNatsRpcUnsafe,
  type UnsafeNatsRpcServer,
} from "../infrastructure/unsafe/nats-rpc.js"
import { makeEpisodeLibraryRpcHandler } from "./episode-library-rpc.js"
import { runEpisodeCompletedConsumerLoop } from "./episode-completed-consumer-loop.js"

const NatsServerSchema = Schema.String.check(
  Schema.isPattern(/^nats:\/\/[\w.-]+(?::\d{1,5})?$/)
)

export const NodeEpisodeLibraryRpcConfigSchema = Schema.Struct({
  sqlitePath: Schema.NonEmptyString.check(Schema.isMaxLength(4_096)),
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
  queueGroup: Schema.NonEmptyString.check(
    Schema.isPattern(/^[a-z][a-z0-9-]{0,62}$/)
  ),
})
export const parseNodeEpisodeLibraryRpcConfig = parse(
  NodeEpisodeLibraryRpcConfigSchema
)

const S3EndpointSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMaxLength(2_048),
  Schema.makeFilter(
    (value) => {
      try {
        const endpoint = new URL(value)
        return (
          (endpoint.protocol === "http:" || endpoint.protocol === "https:") &&
          endpoint.username === "" &&
          endpoint.password === ""
        )
      } catch {
        return false
      }
    },
    { expected: "an HTTP(S) S3 endpoint without credentials" }
  )
)
const S3RegionSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/)
)
const S3BucketSchema = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
)
const S3CredentialSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(1_024)
)

export const NodeEpisodeLibraryServiceConfigSchema = Schema.Struct({
  sqlitePath: Schema.NonEmptyString.check(Schema.isMaxLength(4_096)),
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
  queueGroup: Schema.NonEmptyString.check(
    Schema.isPattern(/^[a-z][a-z0-9-]{0,62}$/)
  ),
  completionConsumer: Schema.Struct({
    stream: Schema.NonEmptyString.check(
      Schema.isPattern(/^[A-Za-z0-9_-]{1,255}$/)
    ),
    durableName: Schema.NonEmptyString.check(
      Schema.isPattern(/^[a-z][a-z0-9-]{0,62}$/)
    ),
    ackWaitMillis: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1_000),
      Schema.isLessThanOrEqualTo(300_000)
    ),
    maximumDeliveries: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(100)
    ),
    initialNackDelayMillis: Schema.Int.check(
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(300_000)
    ),
    maximumNackDelayMillis: Schema.Int.check(
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(300_000)
    ),
  }),
  s3: Schema.Struct({
    endpoint: S3EndpointSchema,
    region: S3RegionSchema,
    bucket: S3BucketSchema,
    accessKeyId: S3CredentialSchema,
    secretAccessKey: S3CredentialSchema,
  }),
})
const parseNodeEpisodeLibraryServiceStructure = parse(
  NodeEpisodeLibraryServiceConfigSchema
)
export const parseNodeEpisodeLibraryServiceConfig = (input: unknown) =>
  parseNodeEpisodeLibraryServiceStructure(input).pipe(
    Effect.filterOrFail(
      (config) =>
        config.completionConsumer.initialNackDelayMillis <=
        config.completionConsumer.maximumNackDelayMillis,
      () => deepFreeze({ _tag: "InvalidCompletionConsumerBackoff" as const })
    )
  )

export type NodeEpisodeLibraryRpcError = DeepReadonly<{
  _tag: "NodeEpisodeLibraryRpcFailed"
  component: "Config" | "Handler" | "Nats" | "Reply" | "Signer" | "Sqlite"
}>

export type NodeEpisodeLibraryRpcDependencies = DeepReadonly<{
  connectNats: (
    servers: readonly string[],
    subjects: readonly string[],
    queueGroup: string
  ) => Promise<UnsafeNatsRpcServer>
  newMessageId: () => string
  now: () => string
  nowEpochMillis: () => number
  makeRepository?: typeof makeSqliteEpisodeRepository
}>

export type NodeEpisodeLibraryServiceDependencies = Readonly<{
  readonly openSigner: (
    config: S3AudioAccessSignerConfig
  ) => S3AudioAccessSignerResource
  readonly rpcDependencies: NodeEpisodeLibraryRpcDependencies
  readonly connectCompletionConsumer: (
    config: Parameters<typeof connectEpisodeCompletedConsumerUnsafe>[0]
  ) => Promise<UnsafeEpisodeCompletedConsumer>
}>

const defaultDependencies: NodeEpisodeLibraryRpcDependencies = deepFreeze({
  connectNats: connectNatsRpcUnsafe,
  newMessageId: randomMessageIdUnsafe,
  now: currentUtcInstantUnsafe,
  nowEpochMillis: currentEpochMillisUnsafe,
  makeRepository: makeSqliteEpisodeRepository,
})

const defaultServiceDependencies: NodeEpisodeLibraryServiceDependencies =
  Object.freeze({
    openSigner: openS3AudioAccessSignerUnsafe,
    rpcDependencies: defaultDependencies,
    connectCompletionConsumer: connectEpisodeCompletedConsumerUnsafe,
  })

const runtimeError = (
  component: NodeEpisodeLibraryRpcError["component"]
): NodeEpisodeLibraryRpcError =>
  deepFreeze({ _tag: "NodeEpisodeLibraryRpcFailed", component })

const runRpcLoop = (
  server: UnsafeNatsRpcServer,
  repository: SqliteEpisodeRepository,
  signer: AudioAccessSigner,
  dependencies: NodeEpisodeLibraryRpcDependencies
): Effect.Effect<void, NodeEpisodeLibraryRpcError> => {
  const handler = makeEpisodeLibraryRpcHandler(repository, signer, dependencies)
  const loop = (): Effect.Effect<void, NodeEpisodeLibraryRpcError> =>
    Effect.tryPromise({
      try: () => server.receive(),
      catch: () => runtimeError("Nats"),
    }).pipe(
      Effect.flatMap((delivery) => {
        if (delivery === undefined) return Effect.void
        return handler({
          subject: delivery.subject,
          payload: delivery.payload,
          reply: (payload) =>
            Effect.tryPromise({
              try: () => delivery.reply(payload),
              catch: () => runtimeError("Reply"),
            }),
        }).pipe(
          Effect.mapError((failure) =>
            typeof failure === "object" &&
            failure !== null &&
            "_tag" in failure &&
            failure._tag === "NodeEpisodeLibraryRpcFailed"
              ? (failure as NodeEpisodeLibraryRpcError)
              : runtimeError("Handler")
          ),
          Effect.andThen(loop())
        )
      })
    )
  return loop()
}

export const runNodeEpisodeLibraryRpc = (
  input: unknown,
  signer: AudioAccessSigner,
  dependencies: NodeEpisodeLibraryRpcDependencies = defaultDependencies
): Effect.Effect<void, NodeEpisodeLibraryRpcError> =>
  parseNodeEpisodeLibraryRpcConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* Effect.acquireRelease(
            Effect.try({
              try: () =>
                (dependencies.makeRepository ?? makeSqliteEpisodeRepository)(
                  config.sqlitePath
                ),
              catch: () => runtimeError("Sqlite"),
            }),
            (resource) => resource.close.pipe(Effect.ignore)
          )
          const server = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                dependencies.connectNats(
                  config.natsServers,
                  [
                    subjects.library.listEpisodes,
                    subjects.library.createAudioAccess,
                  ],
                  config.queueGroup
                ),
              catch: () => runtimeError("Nats"),
            }),
            (resource) =>
              Effect.tryPromise(() => resource.drain()).pipe(Effect.ignore)
          )
          return yield* runRpcLoop(server, repository, signer, dependencies)
        })
      )
    )
  )

const makeCompletionPorts = (
  repository: SqliteEpisodeRepository
): EpisodeCompletionPorts => ({
  materialize: (notice) =>
    parseCompletedEpisode({
      id: notice.episodeId,
      ownerId: notice.ownerId,
      title: notice.title,
      script: notice.script,
      audioObjectKey: notice.audio.objectKey,
      audioByteLength: notice.audio.byteLength,
      audioContentType: notice.audio.contentType,
      createdAt: notice.completedAt,
      sources: notice.sources.map((source) => ({
        sourceKind: "rss" as const,
        snapshotId: source.snapshotId,
        url: source.url,
        title: source.title,
        ...(source.publishedAt === undefined
          ? {}
          : { publishedAt: source.publishedAt }),
      })),
    }).pipe(
      Effect.mapError(() => ({
        _tag: "CompletionMaterializationFailure" as const,
      }))
    ),
  saveOnce: (messageId, episode, receivedAt) =>
    repository.saveOnce(messageId, episode, receivedAt),
})

/** Adds scoped S3 signing to the existing scoped SQLite/NATS RPC runtime. */
export const runNodeEpisodeLibraryService = (
  input: unknown,
  dependencies: NodeEpisodeLibraryServiceDependencies = defaultServiceDependencies
): Effect.Effect<void, NodeEpisodeLibraryRpcError> =>
  parseNodeEpisodeLibraryServiceConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          const signerResource = yield* Effect.acquireRelease(
            Effect.try({
              try: () => dependencies.openSigner(config.s3),
              catch: () => runtimeError("Signer"),
            }),
            (resource) => resource.close.pipe(Effect.ignore)
          )
          const repository = yield* Effect.acquireRelease(
            Effect.try({
              try: () =>
                (
                  dependencies.rpcDependencies.makeRepository ??
                  makeSqliteEpisodeRepository
                )(config.sqlitePath),
              catch: () => runtimeError("Sqlite"),
            }),
            (resource) => resource.close.pipe(Effect.ignore)
          )
          const rpcServer = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                dependencies.rpcDependencies.connectNats(
                  config.natsServers,
                  [
                    subjects.library.listEpisodes,
                    subjects.library.createAudioAccess,
                  ],
                  config.queueGroup
                ),
              catch: () => runtimeError("Nats"),
            }),
            (resource) =>
              Effect.tryPromise(() => resource.drain()).pipe(Effect.ignore)
          )
          const completionConsumer = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                dependencies.connectCompletionConsumer({
                  servers: config.natsServers,
                  stream: config.completionConsumer.stream,
                  durableName: config.completionConsumer.durableName,
                  ackWaitMillis: config.completionConsumer.ackWaitMillis,
                  maximumDeliveries:
                    config.completionConsumer.maximumDeliveries,
                }),
              catch: () => runtimeError("Nats"),
            }),
            (resource) =>
              Effect.tryPromise(() => resource.drain()).pipe(Effect.ignore)
          )

          const rpc = runRpcLoop(
            rpcServer,
            repository,
            signerResource.signer,
            dependencies.rpcDependencies
          )
          const completions = runEpisodeCompletedConsumerLoop(
            completionConsumer,
            makeCompletionPorts(repository),
            config.completionConsumer
          ).pipe(Effect.mapError(() => runtimeError("Nats")))
          return yield* Effect.raceFirst(rpc, completions)
        })
      )
    )
  )
