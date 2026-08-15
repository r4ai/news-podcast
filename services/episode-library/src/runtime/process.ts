import {
  startServiceProcess,
  type ProcessSignal as RuntimeProcessSignal,
  type ServiceProcessController,
  type ServiceProcessDependencies,
} from "@news-podcast/service-runtime"
import type { Effect } from "effect"

export type ProcessSignal = RuntimeProcessSignal
export type EpisodeLibraryProcessDependencies = Omit<
  ServiceProcessDependencies,
  "service"
>
export type EpisodeLibraryProcessController = ServiceProcessController

export const startEpisodeLibraryProcess = <Failure>(
  program: Effect.Effect<void, Failure>,
  dependencies: EpisodeLibraryProcessDependencies
): EpisodeLibraryProcessController =>
  startServiceProcess(program, { service: "episode-library", ...dependencies })
