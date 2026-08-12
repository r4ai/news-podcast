import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type { AudioAccessSigner } from "../application/ports.js"
import {
  makeSqliteEpisodeRepository,
  openS3AudioAccessSignerUnsafe,
  type S3AudioAccessSignerConfig,
  type S3AudioAccessSignerResource,
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
  s3: Schema.Struct({
    endpoint: S3EndpointSchema,
    region: S3RegionSchema,
    bucket: S3BucketSchema,
    accessKeyId: S3CredentialSchema,
    secretAccessKey: S3CredentialSchema,
  }),
})
export const parseNodeEpisodeLibraryServiceConfig = parse(
  NodeEpisodeLibraryServiceConfigSchema
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
  })

const runtimeError = (
  component: NodeEpisodeLibraryRpcError["component"]
): NodeEpisodeLibraryRpcError =>
  deepFreeze({ _tag: "NodeEpisodeLibraryRpcFailed", component })

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
          const handler = makeEpisodeLibraryRpcHandler(
            repository,
            signer,
            dependencies
          )

          while (true) {
            const delivery = yield* Effect.tryPromise({
              try: () => server.receive(),
              catch: () => runtimeError("Nats"),
            })
            if (delivery === undefined) return
            yield* handler({
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
              )
            )
          }
        })
      )
    )
  )

/** Adds scoped S3 signing to the existing scoped SQLite/NATS RPC runtime. */
export const runNodeEpisodeLibraryService = (
  input: unknown,
  dependencies: NodeEpisodeLibraryServiceDependencies = defaultServiceDependencies
): Effect.Effect<void, NodeEpisodeLibraryRpcError> =>
  parseNodeEpisodeLibraryServiceConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.acquireRelease(
          Effect.try({
            try: () => dependencies.openSigner(config.s3),
            catch: () => runtimeError("Signer"),
          }),
          (resource) => resource.close
        ).pipe(
          Effect.flatMap((resource) =>
            runNodeEpisodeLibraryRpc(
              {
                sqlitePath: config.sqlitePath,
                natsServers: config.natsServers,
                queueGroup: config.queueGroup,
              },
              resource.signer,
              dependencies.rpcDependencies
            )
          )
        )
      )
    )
  )
