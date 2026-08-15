import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Cause, Effect, Exit, Fiber } from "effect"

export type ProcessSignal = "SIGINT" | "SIGTERM"
export type FatalProcessEvent = "uncaughtException" | "unhandledRejection"

export type StructuredRuntimeFailure = DeepReadonly<{
  service: string
  component: "runtime"
  scope: "process"
  errorType: string
  cause: string
}>

export type ServiceProcessDependencies = Readonly<{
  service: string
  onceSignal: (signal: ProcessSignal, listener: () => void) => void
  onceFatal?: (
    event: FatalProcessEvent,
    listener: (failure: unknown) => void
  ) => void
  shutdownTelemetry: () => Promise<void>
  exit: (code: number) => void
  reportFailure: (failure: unknown) => void
  shutdownTimeoutMs?: number
}>

export type ServiceProcessController = DeepReadonly<{
  stop: () => void
  completed: Promise<void>
}>

const errorTypeOf = (failure: unknown): string => {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    typeof failure._tag === "string"
  ) {
    return failure._tag
  }
  if (failure instanceof Error) return failure.name
  return typeof failure
}

const redactMessage = (message: string): string =>
  message
    .replace(
      /(authorization|password|secret|token)(\s*[=:]\s*)[^\s,;]+/gi,
      "$1$2[REDACTED]"
    )
    .slice(0, 2_000)

const describeCause = <Failure>(cause: Cause.Cause<Failure>) =>
  cause.reasons.map((reason) => {
    if (Cause.isFailReason(reason)) {
      return { kind: "Fail", errorType: errorTypeOf(reason.error) }
    }
    if (Cause.isDieReason(reason)) {
      const defect = reason.defect
      return {
        kind: "Die",
        errorType: errorTypeOf(defect),
        message:
          defect instanceof Error ? redactMessage(defect.message) : undefined,
      }
    }
    return { kind: "Interrupt" }
  })

export const structuredRuntimeFailure = <Failure>(
  service: string,
  cause: Cause.Cause<Failure>
): StructuredRuntimeFailure => {
  const firstFailure = cause.reasons.find(Cause.isFailReason)?.error
  const firstDefect = cause.reasons.find(Cause.isDieReason)?.defect
  return deepFreeze({
    service,
    component: "runtime",
    scope: "process",
    errorType: errorTypeOf(firstFailure ?? firstDefect ?? "RuntimeFailed"),
    cause: JSON.stringify({ reasons: describeCause(cause) }),
  })
}

const within = async (promise: Promise<void>, timeoutMs: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    promise,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
      timer.unref?.()
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/** Supervises one Effect runtime and is the sole owner of process termination. */
export const startServiceProcess = <Failure>(
  program: Effect.Effect<void, Failure>,
  dependencies: ServiceProcessDependencies
): ServiceProcessController => {
  const fiber = Effect.runFork(program)
  let stopping = false
  let finishing: Promise<void> | undefined
  let resolveCompleted!: () => void
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve
  })

  const finish = (code: number): Promise<void> => {
    if (finishing !== undefined) return finishing
    finishing = within(
      dependencies.shutdownTelemetry(),
      dependencies.shutdownTimeoutMs ?? 5_000
    )
      .catch(dependencies.reportFailure)
      .then(() => dependencies.exit(code))
      .finally(resolveCompleted)
    return finishing
  }

  const interruptAndFinish = (code: number): void => {
    if (stopping) return
    stopping = true
    void Effect.runPromise(Fiber.interrupt(fiber))
      .catch(dependencies.reportFailure)
      .then(() => finish(code))
  }

  const stop = () => interruptAndFinish(0)
  const fatal = (failure: unknown) => {
    dependencies.reportFailure(
      deepFreeze({
        service: dependencies.service,
        component: "runtime",
        scope: "process",
        errorType: errorTypeOf(failure),
        cause: JSON.stringify({ reasons: [{ kind: "FatalProcessEvent" }] }),
      })
    )
    interruptAndFinish(1)
  }

  dependencies.onceSignal("SIGINT", stop)
  dependencies.onceSignal("SIGTERM", stop)
  dependencies.onceFatal?.("uncaughtException", fatal)
  dependencies.onceFatal?.("unhandledRejection", fatal)

  void Effect.runPromise(Fiber.await(fiber)).then((exit) => {
    if (stopping) return
    if (Exit.isFailure(exit)) {
      dependencies.reportFailure(
        structuredRuntimeFailure(dependencies.service, exit.cause)
      )
    } else {
      dependencies.reportFailure(
        deepFreeze({
          service: dependencies.service,
          component: "runtime",
          scope: "process",
          errorType: "UnexpectedRuntimeCompletion",
          cause: JSON.stringify({ reasons: [{ kind: "Success" }] }),
        })
      )
    }
    void finish(1)
  })

  return deepFreeze({ stop, completed })
}
