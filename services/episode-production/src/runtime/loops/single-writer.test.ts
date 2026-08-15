import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { runSingleWriterLoop } from "./single-writer.js"

describe("single-writer RPC loop", () => {
  it("awaits each handler before receiving the next delivery", async () => {
    const pending = [1, 2, 3]
    const completed: number[] = []
    let active = 0
    let maximumActive = 0

    await Effect.runPromise(
      Effect.flip(
        runSingleWriterLoop(
          {
            receive: Effect.sync(() => pending.shift()),
          },
          (value) =>
            Effect.tryPromise(async () => {
              active += 1
              maximumActive = Math.max(maximumActive, active)
              await Promise.resolve()
              completed.push(value)
              active -= 1
            }),
          () => ({ _tag: "SubscriptionClosed" as const }),
          "test"
        )
      )
    )

    expect(completed).toEqual([1, 2, 3])
    expect(maximumActive).toBe(1)
  })
})
