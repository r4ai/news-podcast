import { getNodeObservability } from "@news-podcast/observability/node/register"
import { Effect } from "effect"

import { readContentKnowledgeConfig } from "./runtime/env.js"
import { runNodeService } from "./runtime/node.js"
import { startContentKnowledgeProcess } from "./runtime/process.js"

const observability = getNodeObservability({
  serviceName: "content-knowledge",
  traceSampleRate: 1,
})
const program = readContentKnowledgeConfig(process.env).pipe(
  Effect.flatMap(runNodeService)
)

startContentKnowledgeProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) =>
    console.error("Content Knowledge exited", failure),
})
