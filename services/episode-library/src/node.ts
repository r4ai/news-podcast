import { getNodeObservability } from "@news-podcast/observability/node/register"
import { Effect } from "effect"

import { readEpisodeLibraryConfig } from "./runtime/env.js"
import { runNodeEpisodeLibraryService } from "./runtime/node.js"
import { startEpisodeLibraryProcess } from "./runtime/process.js"

const observability = getNodeObservability({
  serviceName: "episode-library",
  traceSampleRate: 1,
})
const program = readEpisodeLibraryConfig(process.env).pipe(
  Effect.flatMap(runNodeEpisodeLibraryService)
)

startEpisodeLibraryProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) => console.error("Episode Library exited", failure),
})
