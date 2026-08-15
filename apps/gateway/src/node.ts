// Imported only after bootstrap has registered automatic instrumentation.
import { getNodeObservability } from "@news-podcast/observability/node/register"
import { makeEffectOtlpLayerFromEnvironment } from "@news-podcast/observability"
import {
  createHealthState,
  healthServerScoped,
  startServiceProcess,
} from "@news-podcast/service-runtime"
import { Effect } from "effect"

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
const health = createHealthState(["http", "nats"])
const markReady = () => {
  health.ready("nats")
  health.ready("http")
}
const markNotReady = () => {
  health.notReady("http")
  health.notReady("nats")
}
const core = readGatewayConfig(process.env).pipe(
  Effect.flatMap((config) =>
    runNodeGateway(config, {
      ...defaultNodeGatewayDependencies,
      listen: listenNodeHttpUnsafe,
      telemetry: effectTelemetry,
      onReady: markReady,
    })
  )
)
const program = Effect.scoped(
  healthServerScoped(
    Number(process.env.GATEWAY_HEALTH_PORT ?? "4101"),
    health
  ).pipe(Effect.andThen(core), Effect.ensuring(Effect.sync(markNotReady)))
)
startServiceProcess(program, {
  service: "gateway",
  onceSignal: (signal, listener) => process.once(signal, listener),
  onceFatal: (event, listener) => process.once(event, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) => console.error(JSON.stringify(failure)),
})
