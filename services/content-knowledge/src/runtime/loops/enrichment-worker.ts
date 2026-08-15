import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

export type EnrichmentWorkerLoopConfig = DeepReadonly<{
  readonly intervalMillis: number
  readonly initialBackoffMillis: number
  readonly maximumBackoffMillis: number
}>

export type EnrichmentCycleOutcome = DeepReadonly<
  | {
      readonly _tag: "EnrichmentCycleSucceeded"
      readonly processed: number
      readonly nextDelayMillis: number
    }
  | {
      readonly _tag: "EnrichmentCycleFailed"
      readonly consecutiveFailures: number
      readonly nextDelayMillis: number
    }
>

export type EnrichmentWorkerLoopRuntime = Readonly<{
  readonly wait: (delayMillis: number) => Effect.Effect<void>
  readonly observe: (outcome: EnrichmentCycleOutcome) => Effect.Effect<void>
}>

const liveRuntime: EnrichmentWorkerLoopRuntime = Object.freeze({
  wait: Effect.sleep,
  observe: (outcome) =>
    outcome._tag === "EnrichmentCycleSucceeded"
      ? Effect.logInfo("content enrichment cycle succeeded", {
          event_name: "content.enrichment.cycle",
          processed: outcome.processed,
          next_delay_ms: outcome.nextDelayMillis,
        })
      : Effect.logWarning("content enrichment cycle failed", {
          event_name: "content.enrichment.cycle",
          consecutive_failures: outcome.consecutiveFailures,
          next_delay_ms: outcome.nextDelayMillis,
        }),
})

/** Runs one bounded enrichment batch at a time with capped store backoff. */
export const runEnrichmentWorkerLoop = <Failure>(
  config: EnrichmentWorkerLoopConfig,
  runCycle: () => Effect.Effect<{ readonly processed: number }, Failure>,
  runtime: Partial<EnrichmentWorkerLoopRuntime> = liveRuntime
): Effect.Effect<void> => {
  const wait = runtime.wait ?? liveRuntime.wait
  const observe = runtime.observe ?? liveRuntime.observe
  const loop = (
    consecutiveFailures: number,
    backoffMillis: number
  ): Effect.Effect<void> =>
    Effect.suspend(runCycle).pipe(
      Effect.matchEffect({
        onFailure: () => {
          const failures = consecutiveFailures + 1
          const outcome = deepFreeze({
            _tag: "EnrichmentCycleFailed" as const,
            consecutiveFailures: failures,
            nextDelayMillis: backoffMillis,
          })
          return observe(outcome).pipe(
            Effect.andThen(wait(backoffMillis)),
            Effect.andThen(
              loop(
                failures,
                Math.min(backoffMillis * 2, config.maximumBackoffMillis)
              )
            )
          )
        },
        onSuccess: (result) => {
          const outcome = deepFreeze({
            _tag: "EnrichmentCycleSucceeded" as const,
            processed: result.processed,
            nextDelayMillis: config.intervalMillis,
          })
          return observe(outcome).pipe(
            Effect.andThen(wait(config.intervalMillis)),
            Effect.andThen(loop(0, config.initialBackoffMillis))
          )
        },
      })
    )
  return loop(0, config.initialBackoffMillis)
}
