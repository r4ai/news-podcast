import { Clock, Effect } from "effect"

import {
  decideProviderRetry,
  type ProviderFailure,
  type ProviderRetryDecision,
  type ProviderRetryPolicy,
} from "../domain/provider-reliability.js"

export type ProviderRetryExhausted<Failure extends ProviderFailure> = Readonly<{
  readonly _tag: "ProviderRetryExhausted"
  readonly attempts: number
  readonly reason: Exclude<
    Extract<ProviderRetryDecision, { _tag: "Stop" }>["reason"],
    "NonRetryable"
  >
  readonly lastFailure: Failure
}>

export type ProviderRetryRuntime = Readonly<{
  readonly nowMillis: () => Effect.Effect<number>
  readonly sleep: (delayMillis: number) => Effect.Effect<void>
}>

const liveRuntime: ProviderRetryRuntime = Object.freeze({
  nowMillis: () => Clock.currentTimeMillis,
  sleep: (delayMillis) => Effect.sleep(delayMillis),
})

/**
 * Runs a typed provider operation under one shared attempt/time/delay budget.
 * Effect interruption is deliberately not caught, so an in-flight operation or
 * retry sleep remains cancellation-safe.
 */
export const retryProvider = <
  Success,
  Failure extends ProviderFailure,
  Requirements,
>(
  operation: (attempt: number) => Effect.Effect<Success, Failure, Requirements>,
  policy: ProviderRetryPolicy,
  runtime: ProviderRetryRuntime = liveRuntime
): Effect.Effect<
  Success,
  Failure | ProviderRetryExhausted<Failure>,
  Requirements
> =>
  runtime.nowMillis().pipe(
    Effect.flatMap((startedAtMillis) => {
      const loop = (
        attempt: number
      ): Effect.Effect<
        Success,
        Failure | ProviderRetryExhausted<Failure>,
        Requirements
      > =>
        Effect.suspend(() => operation(attempt)).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              runtime.nowMillis().pipe(
                Effect.flatMap((nowMillis) => {
                  const decision = decideProviderRetry({
                    failure,
                    completedAttempts: attempt,
                    startedAtMillis,
                    nowMillis,
                    policy,
                  })
                  if (decision._tag === "Retry") {
                    return runtime
                      .sleep(decision.delayMillis)
                      .pipe(Effect.andThen(loop(attempt + 1)))
                  }
                  if (decision.reason === "NonRetryable") {
                    return Effect.fail(failure)
                  }
                  return Effect.fail(
                    Object.freeze({
                      _tag: "ProviderRetryExhausted" as const,
                      attempts: attempt,
                      reason: decision.reason,
                      lastFailure: failure,
                    })
                  )
                })
              ),
            onSuccess: Effect.succeed,
          })
        )

      return loop(1)
    })
  )
