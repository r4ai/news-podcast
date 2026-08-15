import { getNodeObservability } from "@news-podcast/observability/node/register"
import { makeEffectOtlpLayerFromEnvironment } from "@news-podcast/observability"
import {
  createHealthState,
  healthServerScoped,
} from "@news-podcast/service-runtime"
import { Effect } from "effect"

import { readEpisodeProductionServiceConfig } from "./runtime/env.js"
import { runNodeEpisodeProductionService } from "./runtime/service.js"
import { startEpisodeProductionProcess } from "./runtime/process.js"

const observability = getNodeObservability({
  serviceName: "episode-production",
  traceSampleRate: 1,
})
const effectTelemetry = makeEffectOtlpLayerFromEnvironment(
  process.env,
  "episode-production"
)
const health = createHealthState(["completion-relay", "rpc"])
const markNotReady = () => {
  health.notReady("rpc")
  health.notReady("completion-relay")
}
const core = readEpisodeProductionServiceConfig(process.env)
  .pipe(
    Effect.flatMap((config) =>
      runNodeEpisodeProductionService(config, () => health.ready("rpc"), {
        observability,
        onCompletionRelayHealth: (healthy) =>
          healthy
            ? health.ready("completion-relay")
            : health.notReady("completion-relay"),
      })
    )
  )
  .pipe(Effect.provide(effectTelemetry))
const program = Effect.scoped(
  healthServerScoped(
    Number(process.env.EPISODE_PRODUCTION_HEALTH_PORT ?? "4104"),
    health
  ).pipe(Effect.andThen(core), Effect.ensuring(Effect.sync(markNotReady)))
)

startEpisodeProductionProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  onceFatal: (event, listener) => process.once(event, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) => console.error(JSON.stringify(failure)),
})
