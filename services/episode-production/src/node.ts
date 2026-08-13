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
const health = createHealthState()
const core = readEpisodeProductionServiceConfig(process.env)
  .pipe(
    Effect.flatMap((config) =>
      runNodeEpisodeProductionService(config, health.ready)
    )
  )
  .pipe(Effect.provide(effectTelemetry))
const program = Effect.scoped(
  healthServerScoped(
    Number(process.env.EPISODE_PRODUCTION_HEALTH_PORT ?? "4104"),
    health
  ).pipe(Effect.andThen(core), Effect.ensuring(Effect.sync(health.notReady)))
)

startEpisodeProductionProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) =>
    console.error("Episode Production exited", failure),
})
