import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Layer, Schema } from "effect"

import { acquireNatsGatewayPorts } from "../adapters/nats-gateway-ports.js"
import {
  connectNatsRequestClientUnsafe,
  type UnsafeNatsRequestClient,
} from "../infrastructure/unsafe/nats-request.js"
import {
  currentUtcInstantUnsafe,
  randomUuidUnsafe,
} from "../infrastructure/unsafe/runtime-values.js"
import { makeGatewayAuthProxy } from "./auth-proxy.js"
import { makeGatewayWebHandler } from "./http.js"
import { makeGatewayTelemetryProxy } from "./telemetry-proxy.js"

const NatsServerSchema = Schema.String.check(
  Schema.isPattern(/^nats:\/\/[\w.-]+(?::\d{1,5})?$/)
).pipe(Schema.brand("NatsServer"))
const HttpOriginSchema = Schema.String.check(
  Schema.makeFilter((value: string) => {
    try {
      const url = new URL(value)
      return (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === ""
        ? undefined
        : "Expected a credential-free HTTP origin"
    } catch {
      return "Expected an HTTP origin"
    }
  })
)

export const NodeGatewayConfigSchema = Schema.Struct({
  hostname: Schema.NonEmptyString.check(Schema.isMaxLength(255)),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  natsServers: Schema.NonEmptyArray(NatsServerSchema).check(
    Schema.isMaxLength(10)
  ),
  requestTimeoutMillis: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 30_000 })
  ),
  archiveExecutionTimeoutMillis: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 300_000 })
  ),
  archiveRequestTimeoutMillis: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 305_000 })
  ),
  loginMethods: Schema.Struct({
    development: Schema.Boolean,
    google: Schema.Boolean,
  }),
  identityHttpOrigin: HttpOriginSchema,
  authProxyTimeoutMillis: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 30_000 })
  ),
  authProxyMaximumResponseBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 1_048_576 })
  ),
  telemetryHttpOrigin: HttpOriginSchema,
  telemetryProxyTimeoutMillis: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 30_000 })
  ),
  telemetryProxyMaximumRequestBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 4_194_304 })
  ),
  telemetryProxyMaximumResponseBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: 1_048_576 })
  ),
}).check(
  Schema.makeFilter((config) =>
    config.archiveRequestTimeoutMillis >=
    config.archiveExecutionTimeoutMillis + 1_000
      ? undefined
      : "Archive RPC timeout must leave at least one second to deliver the deadline reply"
  )
)
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
  readonly onReady?: () => void
  readonly telemetry?: Layer.Layer<never, never, never>
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
          const ports = yield* acquireNatsGatewayPorts(config, {
            connect: dependencies.connectNats,
            nextMessageId: dependencies.nextMessageId,
            now: dependencies.now,
          }).pipe(Effect.mapError(() => runtimeError("Nats")))
          const web = makeGatewayWebHandler(
            ports,
            dependencies.telemetry ?? Layer.empty,
            { nextRetryIdempotencyKey: dependencies.nextMessageId }
          )
          const authProxy = makeGatewayAuthProxy({
            upstream: new URL(config.identityHttpOrigin),
            timeoutMillis: config.authProxyTimeoutMillis,
            maximumResponseBytes: config.authProxyMaximumResponseBytes,
            fetch: globalThis.fetch,
            next: web.handler,
          })
          const handler = makeGatewayTelemetryProxy({
            upstream: new URL(config.telemetryHttpOrigin),
            timeoutMillis: config.telemetryProxyTimeoutMillis,
            maximumRequestBytes: config.telemetryProxyMaximumRequestBytes,
            maximumResponseBytes: config.telemetryProxyMaximumResponseBytes,
            fetch: globalThis.fetch,
            next: authProxy,
          })
          yield* Effect.addFinalizer(() =>
            Effect.promise(() => web.dispose()).pipe(Effect.ignore)
          )
          yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                dependencies.listen({
                  hostname: config.hostname,
                  port: config.port,
                  handler,
                }),
              catch: () => runtimeError("Http"),
            }),
            (server) => Effect.promise(() => server.close()).pipe(Effect.ignore)
          )
          dependencies.onReady?.()
          return yield* Effect.tryPromise({
            try: ports.waitForTerminal,
            catch: () => runtimeError("Nats"),
          })
        })
      )
    )
  )

export const defaultNodeGatewayDependencies = deepFreeze({
  connectNats: connectNatsRequestClientUnsafe,
  nextMessageId: randomUuidUnsafe,
  now: currentUtcInstantUnsafe,
})
