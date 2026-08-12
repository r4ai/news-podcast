import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type { AudioAccessSigner } from "../application/ports.js"
import { makeSqliteEpisodeRepository } from "../infrastructure/index.js"
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

export type NodeEpisodeLibraryRpcError = DeepReadonly<{
  _tag: "NodeEpisodeLibraryRpcFailed"
  component: "Config" | "Handler" | "Nats" | "Reply" | "Sqlite"
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
}>

const defaultDependencies: NodeEpisodeLibraryRpcDependencies = deepFreeze({
  connectNats: connectNatsRpcUnsafe,
  newMessageId: randomMessageIdUnsafe,
  now: currentUtcInstantUnsafe,
  nowEpochMillis: currentEpochMillisUnsafe,
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
              try: () => makeSqliteEpisodeRepository(config.sqlitePath),
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
