// Imported only after bootstrap has registered automatic instrumentation.
import { getNodeObservability } from "@news-podcast/observability/node/register"
import { Effect, Fiber } from "effect"

import { listenNodeHttpUnsafe } from "./infrastructure/unsafe/node-http.js"
import {
  defaultNodeGatewayDependencies,
  readGatewayConfig,
  runNodeGateway,
} from "./runtime/index.js"

const observability = getNodeObservability({ serviceName: "gateway" })
const program = readGatewayConfig(process.env).pipe(
  Effect.flatMap((config) =>
    runNodeGateway(config, {
      ...defaultNodeGatewayDependencies,
      listen: listenNodeHttpUnsafe,
    })
  )
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
