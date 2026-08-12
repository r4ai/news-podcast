import { getNodeObservability } from "@news-podcast/observability/node/register"
import { createHealthState, healthServerScoped } from "@news-podcast/service-runtime"
import { Effect } from "effect"

import { readIdentityAccessConfig } from "./runtime/env.js"
import { startIdentityAccessProcess } from "./runtime/process.js"
import {
  defaultIdentityAccessServiceDependencies,
  runIdentityAccessService,
} from "./runtime/service.js"

const observability = getNodeObservability({
  serviceName: "identity-access",
  traceSampleRate: 1,
})
const health = createHealthState()
const core = readIdentityAccessConfig(process.env).pipe(
  Effect.flatMap((config) =>
    runIdentityAccessService(config, {
      ...defaultIdentityAccessServiceDependencies,
      onReady: health.ready,
    })
  )
)
const program = Effect.scoped(
  healthServerScoped(Number(process.env.IDENTITY_HEALTH_PORT ?? "4102"), health).pipe(
    Effect.andThen(core),
    Effect.ensuring(Effect.sync(health.notReady))
  )
)

startIdentityAccessProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) => console.error("Identity Access exited", failure),
})
