import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Fiber } from "effect"

export type ProcessSignal = "SIGINT" | "SIGTERM"

export type ContentKnowledgeProcessDependencies = Readonly<{
  readonly onceSignal: (signal: ProcessSignal, listener: () => void) => void
  readonly shutdownTelemetry: () => Promise<void>
  readonly exit: (code: number) => void
  readonly reportFailure: (failure: unknown) => void
}>

export type ContentKnowledgeProcessController = DeepReadonly<{
  readonly stop: () => void
  readonly completed: Promise<void>
}>

/** Owns OS signals while the Effect program owns runtime resources. */
export const startContentKnowledgeProcess = <Failure>(
  program: Effect.Effect<void, Failure>,
  dependencies: ContentKnowledgeProcessDependencies
): ContentKnowledgeProcessController => {
  const fiber = Effect.runFork(program)
  let stopping = false
  let finishing: Promise<void> | undefined
  let resolveCompleted!: () => void
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve
  })

  const finish = (code: number): Promise<void> => {
    if (finishing !== undefined) return finishing
    finishing = dependencies
      .shutdownTelemetry()
      .catch(dependencies.reportFailure)
      .then(() => dependencies.exit(code))
      .finally(resolveCompleted)
    return finishing
  }

  const stop = (): void => {
    if (stopping) return
    stopping = true
    void Effect.runPromise(Fiber.interrupt(fiber))
      .then(() => finish(0))
      .catch((failure) => {
        dependencies.reportFailure(failure)
        return finish(1)
      })
  }

  dependencies.onceSignal("SIGINT", stop)
  dependencies.onceSignal("SIGTERM", stop)

  void Effect.runPromise(Fiber.await(fiber)).then((exit) => {
    if (stopping) return
    dependencies.reportFailure(exit)
    void finish(1)
  })

  return deepFreeze({ stop, completed })
}
