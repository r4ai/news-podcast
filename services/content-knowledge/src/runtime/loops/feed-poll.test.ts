import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import { makeFeedPollWakeup, runFeedPollLoop } from "./feed-poll.js"

describe("feed polling scheduler", () => {
  it("serializes cycles and backs off after a runtime failure", async () => {
    const delays: number[] = []
    const outcomes: string[] = []
    let active = 0
    let maximumActive = 0
    let calls = 0
    const fiber = Effect.runFork(
      runFeedPollLoop(
        {
          intervalMillis: 1_000,
          initialBackoffMillis: 100,
          maximumBackoffMillis: 250,
        },
        () =>
          Effect.suspend(() => {
            calls += 1
            active += 1
            maximumActive = Math.max(maximumActive, active)
            active -= 1
            return calls === 1
              ? Effect.fail({ _tag: "StoreUnavailable" })
              : Effect.succeed({
                  feeds: 0,
                  discovered: 0,
                  archived: 0,
                  alreadyArchived: 0,
                  failed: 0,
                  failures: [],
                })
          }),
        {
          observe: (outcome) =>
            Effect.sync(() => void outcomes.push(outcome._tag)),
          wait: (delay) => {
            delays.push(delay)
            return calls >= 2 ? Effect.never : Effect.void
          },
        }
      )
    )

    await vi.waitFor(() => expect(calls).toBe(2))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(maximumActive).toBe(1)
    expect(delays).toEqual([100, 1_000])
    expect(outcomes).toEqual(["FeedPollCycleFailed", "FeedPollCycleSucceeded"])
  })

  it("wakes the five-minute scheduler when a subscription is added", async () => {
    const wakeup = makeFeedPollWakeup()
    let calls = 0
    const fiber = Effect.runFork(
      runFeedPollLoop(
        {
          intervalMillis: 300_000,
          initialBackoffMillis: 100,
          maximumBackoffMillis: 300_000,
        },
        () =>
          Effect.sync(() => {
            calls += 1
            return {
              feeds: 0,
              discovered: 0,
              archived: 0,
              alreadyArchived: 0,
              failed: 0,
              failures: [],
            }
          }),
        {
          waitForNextCycle: () => Effect.race(Effect.never, wakeup.wait()),
          observe: () => Effect.void,
        }
      )
    )

    await vi.waitFor(() => expect(calls).toBe(1))
    wakeup.notify()
    await vi.waitFor(() => expect(calls).toBe(2))
    await Effect.runPromise(Fiber.interrupt(fiber))
  })
})
