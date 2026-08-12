import { getNodeObservability } from "@news-podcast/observability/node/register"
import { Effect } from "effect"

import { readIdentityAccessConfig } from "./runtime/env.js"
import { startIdentityAccessProcess } from "./runtime/process.js"
import { runIdentityAccessService } from "./runtime/service.js"

const observability = getNodeObservability({
  serviceName: "identity-access",
  traceSampleRate: 1,
})
const program = readIdentityAccessConfig(process.env).pipe(
  Effect.flatMap(runIdentityAccessService)
)

startIdentityAccessProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) => console.error("Identity Access exited", failure),
})
