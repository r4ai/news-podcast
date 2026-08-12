import { getNodeObservability } from "@news-podcast/observability/node/register"
import { createHealthState, healthServerScoped } from "@news-podcast/service-runtime"
import { Effect } from "effect"

import { readContentKnowledgeConfig } from "./runtime/env.js"
import { defaultNodeServiceDependencies, runNodeService } from "./runtime/node.js"
import { startContentKnowledgeProcess } from "./runtime/process.js"

const observability = getNodeObservability({
  serviceName: "content-knowledge",
  traceSampleRate: 1,
})
const health = createHealthState()
const core = readContentKnowledgeConfig(process.env).pipe(
  Effect.flatMap((config) =>
    runNodeService(config, {
      ...defaultNodeServiceDependencies,
      onReady: health.ready,
    })
  )
)
const program = Effect.scoped(
  healthServerScoped(Number(process.env.CONTENT_HEALTH_PORT ?? "4103"), health).pipe(
    Effect.andThen(core),
    Effect.ensuring(Effect.sync(health.notReady))
  )
)

startContentKnowledgeProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) =>
    console.error("Content Knowledge exited", failure),
})
