import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  runCompletionRelayLoop,
  type CompletionRelayEvent,
} from "./completion-relay.js"

describe("completion relay loop", () => {
  it("backs off transient failures, caps delay, and resets after success", async () => {
    const events: CompletionRelayEvent[] = []
    const health: boolean[] = []
    const delays: number[] = []
    const results = [
      Effect.fail({
        _tag: "PipelineFailure" as const,
        code: "nats_completion_publish" as const,
        retryable: true,
      }),
      Effect.fail({
        _tag: "PipelineFailure" as const,
        code: "nats_completion_publish" as const,
        retryable: true,
      }),
      Effect.succeed({ published: 1, duplicates: 0 }),
    ]
    const fiber = Effect.runFork(
      runCompletionRelayLoop(
        {
          relay: () => results.shift()!,
          observe: (event) => Effect.sync(() => events.push(event)),
          setHealthy: (healthy) => void health.push(healthy),
          wait: (delay) => {
            delays.push(delay)
            return events.length === 3 ? Effect.never : Effect.void
          },
        },
        {
          intervalMillis: 1_000,
          initialBackoffMillis: 100,
          maximumBackoffMillis: 150,
        }
      )
    )

    await vi.waitFor(() => expect(events).toHaveLength(3))
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(delays).toEqual([100, 150, 1_000])
    expect(events.at(-1)).toMatchObject({ _tag: "CompletionRelaySucceeded" })
    expect(health).toEqual([false, false, true])
  })
})
