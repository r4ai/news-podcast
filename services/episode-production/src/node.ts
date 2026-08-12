import { getNodeObservability } from "@news-podcast/observability/node/register"
import { Effect } from "effect"

import { readEpisodeProductionConfig } from "./runtime/env.js"
import { runNodeCreateJobRpc } from "./runtime/node.js"
import { startEpisodeProductionProcess } from "./runtime/process.js"

const observability = getNodeObservability({
  serviceName: "episode-production",
  traceSampleRate: 1,
})
const program = readEpisodeProductionConfig(process.env).pipe(
  Effect.flatMap(runNodeCreateJobRpc)
)

startEpisodeProductionProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) =>
    console.error("Episode Production exited", failure),
})
