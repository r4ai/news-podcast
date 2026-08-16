import { Effect } from "effect"
import type { AiError } from "effect/unstable/ai"

import { toAiRuntimeFailure, type AiRuntimeFailure } from "../domain/failure.js"

const canceled = (): AiRuntimeFailure => Object.freeze({ _tag: "Canceled" })
const timeout = (): AiRuntimeFailure => Object.freeze({ _tag: "Timeout" })

const failWhenAborted = (
  signal: AbortSignal
): Effect.Effect<never, AiRuntimeFailure> =>
  Effect.callback((resume) => {
    const abort = () => resume(Effect.fail(canceled()))
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener("abort", abort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", abort))
  })

/** Applies the shared timeout, cancellation and sanitized Effect AI error policy. */
export const applyAiRuntimePolicy = <A, R>(
  operation: Effect.Effect<A, AiError.AiError, R>,
  input: Readonly<{
    readonly requestTimeoutMillis: number
    readonly signal?: AbortSignal
  }>
): Effect.Effect<A, AiRuntimeFailure, R> => {
  const timed = operation.pipe(
    Effect.mapError(toAiRuntimeFailure),
    Effect.timeoutOrElse({
      duration: input.requestTimeoutMillis,
      orElse: () => Effect.fail(timeout()),
    })
  )
  return input.signal === undefined
    ? timed
    : Effect.raceFirst(timed, failWhenAborted(input.signal))
}
