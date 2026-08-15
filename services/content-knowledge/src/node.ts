import { getNodeObservability } from "@news-podcast/observability/node/register"
import { makeEffectOtlpLayerFromEnvironment } from "@news-podcast/observability"
import {
  createHealthState,
  healthServerScoped,
} from "@news-podcast/service-runtime"
import { Effect } from "effect"

import { readContentKnowledgeConfig } from "./runtime/env.js"
import {
  defaultNodeServiceDependencies,
  runNodeService,
} from "./runtime/node.js"
import { startContentKnowledgeProcess } from "./runtime/process.js"

const observability = getNodeObservability({
  serviceName: "content-knowledge",
  traceSampleRate: 1,
})
const effectTelemetry = makeEffectOtlpLayerFromEnvironment(
  process.env,
  "content-knowledge"
)
const health = createHealthState(["rpc"])
const core = readContentKnowledgeConfig(process.env)
  .pipe(
    Effect.flatMap((config) =>
      runNodeService(config, {
        ...defaultNodeServiceDependencies,
        onReady: () => health.ready("rpc"),
      })
    )
  )
  .pipe(Effect.provide(effectTelemetry))
const program = Effect.scoped(
  healthServerScoped(
    Number(process.env.CONTENT_HEALTH_PORT ?? "4103"),
    health
  ).pipe(
    Effect.andThen(core),
    Effect.ensuring(Effect.sync(() => health.notReady("rpc")))
  )
)

startContentKnowledgeProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  onceFatal: (event, listener) => process.once(event, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) => console.error(JSON.stringify(failure)),
})
