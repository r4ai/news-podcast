import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import { runEnrichmentWorkerLoop } from "./enrichment-worker.js"

const config = {
  intervalMillis: 1_000,
  initialBackoffMillis: 100,
  maximumBackoffMillis: 800,
}

describe("enrichment worker loop", () => {
  it("runs non-overlapping bounded cycles at the steady interval", async () => {
    const outcomes: unknown[] = []
    const runCycle = vi.fn(() => Effect.succeed({ processed: 3 }))

    const fiber = Effect.runFork(
      runEnrichmentWorkerLoop(config, runCycle, {
        observe: (outcome) => Effect.sync(() => void outcomes.push(outcome)),
        wait: () => Effect.never,
      })
    )
    await vi.waitFor(() => expect(outcomes).toHaveLength(1))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(runCycle).toHaveBeenCalledOnce()
    expect(outcomes).toEqual([
      {
        _tag: "EnrichmentCycleSucceeded",
        processed: 3,
        nextDelayMillis: 1_000,
      },
    ])
  })

  it("backs off infrastructure failures without terminating the service", async () => {
    const outcomes: unknown[] = []

    const fiber = Effect.runFork(
      runEnrichmentWorkerLoop(
        config,
        () => Effect.fail({ _tag: "EnrichmentQueueFailed" }),
        {
          observe: (outcome) => Effect.sync(() => void outcomes.push(outcome)),
          wait: () => Effect.never,
        }
      )
    )
    await vi.waitFor(() => expect(outcomes).toHaveLength(1))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(outcomes).toEqual([
      {
        _tag: "EnrichmentCycleFailed",
        consecutiveFailures: 1,
        nextDelayMillis: 100,
      },
    ])
  })
})
