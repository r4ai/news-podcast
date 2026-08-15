import {
  startServiceProcess,
  type ProcessSignal as RuntimeProcessSignal,
  type ServiceProcessController,
  type ServiceProcessDependencies,
} from "@news-podcast/service-runtime"
import type { Effect } from "effect"

export type ProcessSignal = RuntimeProcessSignal
export type EpisodeProductionProcessDependencies = Omit<
  ServiceProcessDependencies,
  "service"
>
export type EpisodeProductionProcessController = ServiceProcessController

export const startEpisodeProductionProcess = <Failure>(
  program: Effect.Effect<void, Failure>,
  dependencies: EpisodeProductionProcessDependencies
): EpisodeProductionProcessController =>
  startServiceProcess(program, {
    service: "episode-production",
    ...dependencies,
  })
