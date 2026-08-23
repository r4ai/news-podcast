import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import { runArticleSearchIndexLoop } from "./article-search-index.js"

describe("article search index loop", () => {
  it("backs off store failures and resets after a successful cycle", async () => {
    const waits: number[] = []
    const observed: number[] = []
    let cycles = 0
    const fiber = Effect.runFork(
      runArticleSearchIndexLoop(
        {
          intervalMillis: 5_000,
          initialBackoffMillis: 100,
          maximumBackoffMillis: 400,
        },
        () =>
          Effect.suspend(() => {
            cycles += 1
            return cycles <= 2 ? Effect.fail("store") : Effect.succeed({})
          }),
        {
          wait: (delay) =>
            Effect.sync(() => {
              waits.push(delay)
              if (waits.length === 4) return
            }),
          observeStoreFailure: ({ consecutiveFailures }) =>
            Effect.sync(() => {
              observed.push(consecutiveFailures)
            }),
        }
      )
    )

    await vi.waitFor(() => expect(waits.length).toBeGreaterThanOrEqual(4))
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(waits.slice(0, 4)).toEqual([100, 200, 5_000, 5_000])
    expect(observed).toEqual([1, 2])
  })
})
