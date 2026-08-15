import {
  startServiceProcess,
  type ProcessSignal as RuntimeProcessSignal,
  type ServiceProcessController,
  type ServiceProcessDependencies,
} from "@news-podcast/service-runtime"
import type { Effect } from "effect"

export type ProcessSignal = RuntimeProcessSignal
export type ContentKnowledgeProcessDependencies = Omit<
  ServiceProcessDependencies,
  "service"
>
export type ContentKnowledgeProcessController = ServiceProcessController

export const startContentKnowledgeProcess = <Failure>(
  program: Effect.Effect<void, Failure>,
  dependencies: ContentKnowledgeProcessDependencies
): ContentKnowledgeProcessController =>
  startServiceProcess(program, {
    service: "content-knowledge",
    ...dependencies,
  })
