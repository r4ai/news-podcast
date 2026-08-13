// Imported only after bootstrap has registered automatic instrumentation.
import { getNodeObservability } from "@news-podcast/observability/node/register"
import { makeEffectOtlpLayerFromEnvironment } from "@news-podcast/observability"
import {
  createHealthState,
  healthServerScoped,
} from "@news-podcast/service-runtime"
import { Effect, Fiber } from "effect"

import { listenNodeHttpUnsafe } from "./infrastructure/unsafe/node-http.js"
import {
  defaultNodeGatewayDependencies,
  readGatewayConfig,
  runNodeGateway,
} from "./runtime/index.js"

const observability = getNodeObservability({ serviceName: "gateway" })
const effectTelemetry = makeEffectOtlpLayerFromEnvironment(
  process.env,
  "gateway"
)
const health = createHealthState()
const core = readGatewayConfig(process.env).pipe(
  Effect.flatMap((config) =>
    runNodeGateway(config, {
      ...defaultNodeGatewayDependencies,
      listen: listenNodeHttpUnsafe,
      telemetry: effectTelemetry,
      onReady: health.ready,
    })
  )
)
const program = Effect.scoped(
  healthServerScoped(
    Number(process.env.GATEWAY_HEALTH_PORT ?? "4101"),
    health
  ).pipe(Effect.andThen(core), Effect.ensuring(Effect.sync(health.notReady)))
)
const fiber = Effect.runFork(program)
let stopping = false

const stop = () => {
  if (stopping) return
  stopping = true
  void Effect.runPromise(Fiber.interrupt(fiber))
    .then(() => observability.shutdown())
    .finally(() => process.exit(0))
}

process.once("SIGINT", stop)
process.once("SIGTERM", stop)

void Effect.runPromise(Fiber.await(fiber)).then((exit) => {
  if (!stopping) {
    console.error("Gateway runtime exited", exit)
    void observability.shutdown().finally(() => process.exit(1))
  }
})
