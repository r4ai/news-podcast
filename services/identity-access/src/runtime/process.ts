import {
  startServiceProcess,
  type ProcessSignal,
  type ServiceProcessController,
  type ServiceProcessDependencies,
} from "@news-podcast/service-runtime"
import type { Effect } from "effect"

export type IdentityProcessSignal = ProcessSignal
export type IdentityAccessProcessDependencies = Omit<
  ServiceProcessDependencies,
  "service"
>
export type IdentityAccessProcessController = ServiceProcessController

export const startIdentityAccessProcess = <Failure>(
  program: Effect.Effect<void, Failure>,
  dependencies: IdentityAccessProcessDependencies
): IdentityAccessProcessController =>
  startServiceProcess(program, { service: "identity-access", ...dependencies })
