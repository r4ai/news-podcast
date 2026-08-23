import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

export type ArticleSearchIndexLoopConfig = DeepReadonly<{
  readonly intervalMillis: number
  readonly initialBackoffMillis: number
  readonly maximumBackoffMillis: number
}>

type LoopRuntime = Readonly<{
  readonly wait: (delayMillis: number) => Effect.Effect<void>
  readonly observeStoreFailure: (input: {
    readonly consecutiveFailures: number
    readonly nextDelayMillis: number
  }) => Effect.Effect<void>
}>

const liveRuntime: LoopRuntime = Object.freeze({
  wait: Effect.sleep,
  observeStoreFailure: ({ consecutiveFailures, nextDelayMillis }) =>
    Effect.logWarning("article search index cycle failed", {
      event_name: "article.search_body.index_failed",
      reason: "StoreUnavailable",
      consecutive_failures: consecutiveFailures,
      next_delay_ms: nextDelayMillis,
    }),
})

/** Serial scheduler: object failures are item outcomes; store failures back off. */
export const runArticleSearchIndexLoop = <Failure>(
  config: ArticleSearchIndexLoopConfig,
  runCycle: () => Effect.Effect<unknown, Failure>,
  runtime: Partial<LoopRuntime> = liveRuntime
): Effect.Effect<void> => {
  const wait = runtime.wait ?? liveRuntime.wait
  const observeStoreFailure =
    runtime.observeStoreFailure ?? liveRuntime.observeStoreFailure
  const loop = (
    consecutiveFailures: number,
    backoffMillis: number
  ): Effect.Effect<void> =>
    Effect.suspend(runCycle).pipe(
      Effect.matchEffect({
        onFailure: () => {
          const failures = consecutiveFailures + 1
          return observeStoreFailure(
            deepFreeze({
              consecutiveFailures: failures,
              nextDelayMillis: backoffMillis,
            })
          ).pipe(
            Effect.andThen(wait(backoffMillis)),
            Effect.andThen(
              Effect.suspend(() =>
                loop(
                  failures,
                  Math.min(backoffMillis * 2, config.maximumBackoffMillis)
                )
              )
            )
          )
        },
        onSuccess: () =>
          wait(config.intervalMillis).pipe(
            Effect.andThen(
              Effect.suspend(() => loop(0, config.initialBackoffMillis))
            )
          ),
      })
    )
  return loop(0, config.initialBackoffMillis)
}
