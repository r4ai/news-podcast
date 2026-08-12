import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { ProviderRetryPolicy } from "../domain/provider-reliability.js"
import { retryProvider } from "./retry-provider.js"

const policy: ProviderRetryPolicy = {
  maximumAttempts: 4,
  maximumElapsedMillis: 30_000,
  baseDelayMillis: 1_000,
  maximumDelayMillis: 10_000,
}

describe("retryProvider", () => {
  it("retries deterministically with injected clock and sleep", async () => {
    const delays: number[] = []
    const times = [0, 0, 1_000, 3_000]
    const operation = vi
      .fn<(attempt: number) => Effect.Effect<string, { _tag: "Timeout" }>>()
      .mockReturnValueOnce(Effect.fail({ _tag: "Timeout" }))
      .mockReturnValueOnce(Effect.fail({ _tag: "Timeout" }))
      .mockReturnValueOnce(Effect.succeed("ok"))

    const value = await Effect.runPromise(
      retryProvider(operation, policy, {
        nowMillis: () => Effect.succeed(times.shift() ?? 3_000),
        sleep: (delayMillis) =>
          Effect.sync(() => {
            delays.push(delayMillis)
          }),
      })
    )

    expect(value).toBe("ok")
    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3])
    expect(delays).toEqual([1_000, 2_000])
  })

  it("returns a typed exhaustion failure with the last provider failure", async () => {
    const failure = { _tag: "HttpFailure", status: 503 } as const
    const exhausted = await Effect.runPromise(
      Effect.flip(
        retryProvider(() => Effect.fail(failure), policy, {
          nowMillis: () => Effect.succeed(0),
          sleep: () => Effect.void,
        })
      )
    )

    expect(exhausted).toEqual({
      _tag: "ProviderRetryExhausted",
      attempts: 4,
      reason: "AttemptLimit",
      lastFailure: failure,
    })
  })

  it("does not retry a permanent provider failure", async () => {
    const operation = vi.fn(() => Effect.fail({ _tag: "Refusal" } as const))
    const failure = await Effect.runPromise(
      Effect.flip(
        retryProvider(operation, policy, {
          nowMillis: () => Effect.succeed(0),
          sleep: () => Effect.die("must not sleep"),
        })
      )
    )

    expect(operation).toHaveBeenCalledOnce()
    expect(failure).toEqual({ _tag: "Refusal" })
  })

  it("interrupts an injected retry sleep without starting another attempt", async () => {
    let enteredSleep = () => {}
    const sleeping = new Promise<void>((resolve) => {
      enteredSleep = resolve
    })
    let sleepInterrupted = false
    const operation = vi.fn(() => Effect.fail({ _tag: "Timeout" } as const))
    const fiber = Effect.runFork(
      retryProvider(operation, policy, {
        nowMillis: () => Effect.succeed(0),
        sleep: () =>
          Effect.sync(enteredSleep).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                sleepInterrupted = true
              })
            )
          ),
      })
    )

    await sleeping
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(sleepInterrupted).toBe(true)
    expect(operation).toHaveBeenCalledOnce()
  })
})
