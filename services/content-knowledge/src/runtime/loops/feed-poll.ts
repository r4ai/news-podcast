import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { FeedPollResult } from "../../application/poll-subscriptions.js"

export type FeedPollLoopConfig = DeepReadonly<{
  readonly intervalMillis: number
  readonly initialBackoffMillis: number
  readonly maximumBackoffMillis: number
}>

export type FeedPollCycleOutcome = DeepReadonly<
  | ({
      readonly _tag: "FeedPollCycleSucceeded"
      readonly nextDelayMillis: number
    } & FeedPollResult)
  | {
      readonly _tag: "FeedPollCycleFailed"
      readonly consecutiveFailures: number
      readonly nextDelayMillis: number
    }
>

export type FeedPollLoopRuntime = Readonly<{
  readonly wait: (delayMillis: number) => Effect.Effect<void>
  readonly waitForNextCycle?: (delayMillis: number) => Effect.Effect<void>
  readonly observe: (outcome: FeedPollCycleOutcome) => Effect.Effect<void>
}>

export type FeedPollWakeup = Readonly<{
  readonly notify: () => void
  readonly wait: () => Effect.Effect<void>
}>

export const classifyFeedPollTelemetry = (
  outcome: Pick<FeedPollResult, "failed" | "failures">
): "content.feed.poll" | "rss.sync.degraded" | "rss.sync.failed" =>
  outcome.failed === 0
    ? "content.feed.poll"
    : outcome.failures.some((failure) => failure.scope === "Feed")
      ? "rss.sync.failed"
      : "rss.sync.degraded"

/** Allows a newly queued feed to interrupt the long periodic scheduler delay. */
export const makeFeedPollWakeup = (): FeedPollWakeup => {
  let pending = false
  let resolve: (() => void) | undefined
  return deepFreeze({
    notify: () => {
      pending = true
      const current = resolve
      resolve = undefined
      current?.()
    },
    wait: () =>
      Effect.promise(() =>
        pending
          ? ((pending = false), Promise.resolve())
          : new Promise<void>((resume) => {
              resolve = () => {
                pending = false
                resume()
              }
            })
      ),
  })
}

const liveRuntime: FeedPollLoopRuntime = Object.freeze({
  wait: (delayMillis) => Effect.sleep(delayMillis),
  observe: (outcome) => {
    if (outcome._tag === "FeedPollCycleFailed")
      return Effect.logWarning("content feed poll cycle failed", {
        event_name: "content.feed.poll",
        consecutive_failures: outcome.consecutiveFailures,
        next_delay_ms: outcome.nextDelayMillis,
      })

    const eventName = classifyFeedPollTelemetry(outcome)
    return eventName === "content.feed.poll"
      ? Effect.logInfo("content feed poll cycle succeeded", {
          event_name: eventName,
          feeds: outcome.feeds,
          discovered: outcome.discovered,
          archived: outcome.archived,
          failed: outcome.failed,
        })
      : Effect.logWarning(
          eventName === "rss.sync.degraded"
            ? "content feed poll cycle degraded"
            : "content feed poll cycle failed",
          {
            event_name: eventName,
            feeds: outcome.feeds,
            discovered: outcome.discovered,
            archived: outcome.archived,
            failed: outcome.failed,
            "failure.stage": eventName === "rss.sync.failed" ? "feed" : "item",
          }
        )
  },
})

/** Runs a single non-overlapping scheduler with capped infrastructure backoff. */
export const runFeedPollLoop = <Failure>(
  config: FeedPollLoopConfig,
  pollOnce: () => Effect.Effect<FeedPollResult, Failure>,
  runtime: Partial<FeedPollLoopRuntime> = liveRuntime
): Effect.Effect<void> => {
  const wait = runtime.wait ?? liveRuntime.wait
  const waitForNextCycle = runtime.waitForNextCycle ?? wait
  const observe = runtime.observe ?? liveRuntime.observe
  const loop = (
    consecutiveFailures: number,
    backoffMillis: number
  ): Effect.Effect<void> =>
    Effect.suspend(pollOnce).pipe(
      Effect.matchEffect({
        onFailure: () => {
          const outcome = deepFreeze({
            _tag: "FeedPollCycleFailed" as const,
            consecutiveFailures: consecutiveFailures + 1,
            nextDelayMillis: backoffMillis,
          })
          return observe(outcome).pipe(
            Effect.andThen(waitForNextCycle(backoffMillis)),
            Effect.andThen(
              Effect.suspend(() =>
                loop(
                  consecutiveFailures + 1,
                  Math.min(backoffMillis * 2, config.maximumBackoffMillis)
                )
              )
            )
          )
        },
        onSuccess: (result) => {
          const outcome = deepFreeze({
            _tag: "FeedPollCycleSucceeded" as const,
            ...result,
            nextDelayMillis: config.intervalMillis,
          })
          return observe(outcome).pipe(
            Effect.andThen(waitForNextCycle(config.intervalMillis)),
            Effect.andThen(
              Effect.suspend(() => loop(0, config.initialBackoffMillis))
            )
          )
        },
      })
    )
  return loop(0, config.initialBackoffMillis)
}
