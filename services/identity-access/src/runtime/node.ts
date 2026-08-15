import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import {
  logRpcDeliveryFailure,
  runSequentialRpcLoop,
} from "@news-podcast/nats-runtime"
import { subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import {
  makeBetterAuthSessionReader,
  type BetterAuthSessionApi,
} from "../adapters/better-auth-session-reader.js"
import {
  connectNatsRpcUnsafe,
  type UnsafeNatsRpcServer,
} from "../infrastructure/unsafe/nats-rpc.js"
import {
  currentUtcInstantUnsafe,
  randomMessageIdUnsafe,
} from "../infrastructure/unsafe/identity.js"
import { makeResolveSessionRpcHandler } from "./resolve-session-rpc.js"
import {
  makeIdentitySettingsRpcHandler,
  type IdentitySettingsRpcDelivery,
  type IdentitySettingsRpcOperations,
} from "./settings-rpc.js"
import {
  makeScheduledGenerationRpcHandler,
  type ScheduledGenerationRpcOperations,
} from "./scheduled-generation-rpc.js"

const NatsServerSchema = Schema.String.check(
  Schema.isPattern(/^nats:\/\/[\w.-]+(?::\d{1,5})?$/)
).pipe(Schema.brand("NatsServer"))

export const NodeResolveSessionRpcConfigSchema = Schema.Struct({
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
  queueGroup: Schema.NonEmptyString.check(
    Schema.isPattern(/^[a-z][a-z0-9-]{0,62}$/)
  ),
})
export const parseNodeResolveSessionRpcConfig = parse(
  NodeResolveSessionRpcConfigSchema
)

export type NodeResolveSessionRpcError = DeepReadonly<{
  readonly _tag: "NodeResolveSessionRpcFailed"
  readonly component: "Config" | "Handler" | "Nats" | "Reply"
}>

export type NodeResolveSessionRpcDependencies = DeepReadonly<{
  readonly connectNats: (
    servers: readonly string[],
    subject: string | readonly string[],
    queueGroup: string
  ) => Promise<UnsafeNatsRpcServer>
  readonly newMessageId: () => string
  readonly now: () => string
  readonly onReady?: () => void
}>

export const defaultNodeResolveSessionRpcDependencies: NodeResolveSessionRpcDependencies =
  deepFreeze({
    connectNats: connectNatsRpcUnsafe,
    newMessageId: randomMessageIdUnsafe,
    now: currentUtcInstantUnsafe,
  })

const runtimeError = (
  component: NodeResolveSessionRpcError["component"]
): NodeResolveSessionRpcError =>
  deepFreeze({ _tag: "NodeResolveSessionRpcFailed" as const, component })

const isRuntimeError = (
  failure: unknown
): failure is NodeResolveSessionRpcError =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "NodeResolveSessionRpcFailed"

/** Scoped Identity RPC runtime. Better Auth remains an injected boundary. */
export const runNodeResolveSessionRpc = (
  input: unknown,
  api: BetterAuthSessionApi,
  dependencies: NodeResolveSessionRpcDependencies = defaultNodeResolveSessionRpcDependencies
): Effect.Effect<void, NodeResolveSessionRpcError> =>
  parseNodeResolveSessionRpcConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                dependencies.connectNats(
                  config.natsServers,
                  subjects.identity.resolveSession,
                  config.queueGroup
                ),
              catch: () => runtimeError("Nats"),
            }),
            (resource) =>
              Effect.tryPromise(() => resource.drain()).pipe(Effect.ignore)
          )
          const handler = makeResolveSessionRpcHandler(
            makeBetterAuthSessionReader(api),
            dependencies
          )
          dependencies.onReady?.()

          return yield* runSequentialRpcLoop({
            receive: Effect.tryPromise({
              try: () => server.receive(),
              catch: () => runtimeError("Nats"),
            }),
            sourceClosed: () => runtimeError("Nats"),
            handle: (delivery) =>
              handler({
                payload: delivery.payload,
                reply: (payload) =>
                  Effect.tryPromise({
                    try: () => delivery.reply(payload),
                    catch: () => runtimeError("Reply"),
                  }),
              }).pipe(
                Effect.mapError((failure) =>
                  isRuntimeError(failure) ? failure : runtimeError("Handler")
                )
              ),
            onDeliveryFailure: (cause) =>
              logRpcDeliveryFailure(
                "identity-access",
                subjects.identity.resolveSession,
                cause
              ),
          })
        })
      )
    )
  )

type SettingsHandler = (
  delivery: IdentitySettingsRpcDelivery<NodeResolveSessionRpcError>
) => Effect.Effect<void, unknown, never>

/** Runs session resolution and both owner-scoped settings subjects together. */
export const runNodeIdentityRpc = (
  input: unknown,
  api: BetterAuthSessionApi,
  settings: IdentitySettingsRpcOperations & ScheduledGenerationRpcOperations,
  dependencies: NodeResolveSessionRpcDependencies = defaultNodeResolveSessionRpcDependencies
): Effect.Effect<void, NodeResolveSessionRpcError> =>
  parseNodeResolveSessionRpcConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handlerEntries: readonly (readonly [
            string,
            SettingsHandler,
          ])[] = [
            [
              subjects.identity.resolveSession,
              makeResolveSessionRpcHandler(
                makeBetterAuthSessionReader(api),
                dependencies
              ),
            ],
            [
              subjects.identity.getGenerationSettings,
              makeIdentitySettingsRpcHandler(
                subjects.identity.getGenerationSettings,
                settings,
                dependencies
              ),
            ],
            [
              subjects.identity.updateGenerationSettings,
              makeIdentitySettingsRpcHandler(
                subjects.identity.updateGenerationSettings,
                settings,
                dependencies
              ),
            ],
            [
              subjects.identity.discoverDueGenerations,
              makeScheduledGenerationRpcHandler(
                subjects.identity.discoverDueGenerations,
                settings,
                dependencies
              ),
            ],
            [
              subjects.identity.completeScheduledGeneration,
              makeScheduledGenerationRpcHandler(
                subjects.identity.completeScheduledGeneration,
                settings,
                dependencies
              ),
            ],
          ]
          const handlers = new Map(handlerEntries)
          const server = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                dependencies.connectNats(
                  config.natsServers,
                  handlerEntries.map(([subject]) => subject),
                  config.queueGroup
                ),
              catch: () => runtimeError("Nats"),
            }),
            (resource) =>
              Effect.tryPromise(() => resource.drain()).pipe(Effect.ignore)
          )
          dependencies.onReady?.()

          return yield* runSequentialRpcLoop({
            receive: Effect.tryPromise({
              try: () => server.receive(),
              catch: () => runtimeError("Nats"),
            }),
            sourceClosed: () => runtimeError("Nats"),
            handle: (delivery) => {
              const handler =
                delivery.subject === undefined
                  ? undefined
                  : handlers.get(delivery.subject)
              if (handler === undefined) {
                return Effect.fail(runtimeError("Handler"))
              }
              return handler({
                payload: delivery.payload,
                reply: (payload) =>
                  Effect.tryPromise({
                    try: () => delivery.reply(payload),
                    catch: () => runtimeError("Reply"),
                  }),
              }).pipe(
                Effect.mapError((failure) =>
                  isRuntimeError(failure) ? failure : runtimeError("Handler")
                )
              )
            },
            onDeliveryFailure: (cause) =>
              logRpcDeliveryFailure("identity-access", "rpc", cause),
          })
        })
      )
    )
  )
