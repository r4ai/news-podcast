import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import { acquireNatsGatewayPorts } from "../adapters/nats-gateway-ports.js"
import {
  connectNatsRequestClientUnsafe,
  type UnsafeNatsRequestClient,
} from "../infrastructure/unsafe/nats-request.js"
import {
  currentUtcInstantUnsafe,
  randomUuidUnsafe,
} from "../infrastructure/unsafe/runtime-values.js"
import { makeGatewayWebHandler } from "./http.js"

const NatsServerSchema = Schema.String.check(
  Schema.isPattern(/^nats:\/\/[\w.-]+(?::\d{1,5})?$/)
).pipe(Schema.brand("NatsServer"))

export const NodeGatewayConfigSchema = Schema.Struct({
  hostname: Schema.NonEmptyString.check(Schema.isMaxLength(255)),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
  requestTimeoutMillis: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 30_000 })
  ),
  loginMethods: Schema.Struct({
    development: Schema.Boolean,
    google: Schema.Boolean,
  }),
})
export const parseNodeGatewayConfig = parse(NodeGatewayConfigSchema)

export type UnsafeGatewayHttpServer = DeepReadonly<{
  readonly close: () => Promise<void>
}>

type ListenInput = Readonly<{
  hostname: string
  port: number
  handler: (request: Request) => Promise<Response>
}>

export type NodeGatewayRuntimeError = DeepReadonly<{
  readonly _tag: "GatewayRuntimeFailed"
  readonly component: "Config" | "Http" | "Nats"
}>

export type NodeGatewayDependencies = Readonly<{
  readonly connectNats: (
    servers: readonly string[]
  ) => Promise<UnsafeNatsRequestClient>
  readonly listen: (input: ListenInput) => Promise<UnsafeGatewayHttpServer>
  readonly nextMessageId: () => string
  readonly now: () => string
}>

const runtimeError = (
  component: NodeGatewayRuntimeError["component"]
): NodeGatewayRuntimeError =>
  deepFreeze({ _tag: "GatewayRuntimeFailed" as const, component })

/**
 * Scoped process core. Interruption closes HTTP first, then drains NATS.
 * Signal ownership and concrete Node HTTP interop belong to the OS entrypoint.
 */
export const runNodeGateway = (
  input: unknown,
  dependencies: NodeGatewayDependencies
): Effect.Effect<void, NodeGatewayRuntimeError> =>
  parseNodeGatewayConfig(input).pipe(
    Effect.mapError(() => runtimeError("Config")),
    Effect.flatMap((config) =>
      Effect.scoped(
        Effect.gen(function* () {
          const ports = yield* acquireNatsGatewayPorts(
            config,
            {
              connect: dependencies.connectNats,
              nextMessageId: dependencies.nextMessageId,
              now: dependencies.now,
            }
          ).pipe(Effect.mapError(() => runtimeError("Nats")))
          const web = makeGatewayWebHandler(ports)
          yield* Effect.addFinalizer(() =>
            Effect.promise(() => web.dispose()).pipe(Effect.ignore)
          )
          yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                dependencies.listen({
                  hostname: config.hostname,
                  port: config.port,
                  handler: web.handler,
                }),
              catch: () => runtimeError("Http"),
            }),
            (server) => Effect.promise(() => server.close()).pipe(Effect.ignore)
          )
          return yield* Effect.never
        })
      )
    )
  )

export const defaultNodeGatewayDependencies = deepFreeze({
  connectNats: connectNatsRequestClientUnsafe,
  nextMessageId: randomUuidUnsafe,
  now: currentUtcInstantUnsafe,
})
