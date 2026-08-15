import { getNodeObservability } from "@news-podcast/observability/node/register"
import { makeEffectOtlpLayerFromEnvironment } from "@news-podcast/observability"
import {
  createHealthState,
  healthServerScoped,
} from "@news-podcast/service-runtime"
import { Effect } from "effect"

import { readEpisodeLibraryConfig } from "./runtime/env.js"
import {
  defaultNodeEpisodeLibraryServiceDependencies,
  runNodeEpisodeLibraryService,
} from "./runtime/node.js"
import { startEpisodeLibraryProcess } from "./runtime/process.js"

const observability = getNodeObservability({
  serviceName: "episode-library",
  traceSampleRate: 1,
})
const effectTelemetry = makeEffectOtlpLayerFromEnvironment(
  process.env,
  "episode-library"
)
const health = createHealthState(["completion-consumer", "rpc"])
const markReady = () => {
  health.ready("rpc")
  health.ready("completion-consumer")
}
const markNotReady = () => {
  health.notReady("rpc")
  health.notReady("completion-consumer")
}
const core = readEpisodeLibraryConfig(process.env)
  .pipe(
    Effect.flatMap((config) =>
      runNodeEpisodeLibraryService(config, {
        ...defaultNodeEpisodeLibraryServiceDependencies,
        onReady: markReady,
      })
    )
  )
  .pipe(Effect.provide(effectTelemetry))
const program = Effect.scoped(
  healthServerScoped(
    Number(process.env.EPISODE_LIBRARY_HEALTH_PORT ?? "4105"),
    health
  ).pipe(Effect.andThen(core), Effect.ensuring(Effect.sync(markNotReady)))
)

startEpisodeLibraryProcess(program, {
  onceSignal: (signal, listener) => process.once(signal, listener),
  onceFatal: (event, listener) => process.once(event, listener),
  shutdownTelemetry: () => observability.shutdown(),
  exit: (code) => process.exit(code),
  reportFailure: (failure) => console.error(JSON.stringify(failure)),
})
