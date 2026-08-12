import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import type {
  OutboxPublisherError,
  OutboxStoreError,
  RelayResult,
} from "../adapters/index.js"
import {
  runOutboxRelayLoop,
  type OutboxRelayCycleOutcome,
} from "./outbox-relay-loop.js"

const config = {
  batchSize: 10,
  intervalMillis: 1_000,
  initialBackoffMillis: 100,
  maximumBackoffMillis: 250,
}

const publisherUnavailable: OutboxPublisherError = {
  _tag: "OutboxPublishFailed",
  reason: "Unavailable",
}
const storeUnavailable: OutboxStoreError = {
  _tag: "OutboxStoreFailed",
  operation: "ListPending",
  reason: "Unavailable",
}

describe("continuous outbox relay", () => {
  it("serializes cycles and never overlaps relay calls", async () => {
    let active = 0
    let maximumActive = 0
    let calls = 0
    const delays: number[] = []
    const fiber = Effect.runFork(
      runOutboxRelayLoop(
        config,
        () =>
          Effect.tryPromise(async () => {
            calls += 1
            active += 1
            maximumActive = Math.max(maximumActive, active)
            await Promise.resolve()
            active -= 1
            return { published: 0, duplicates: 0 }
          }),
        {
          wait: (delayMillis) => {
            delays.push(delayMillis)
            return calls >= 3 ? Effect.never : Effect.void
          },
        }
      )
    )

    await vi.waitFor(() => expect(calls).toBe(3))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(maximumActive).toBe(1)
    expect(delays).toEqual([1_000, 1_000, 1_000])
  })

  it("survives transient store and publish failures with capped backoff", async () => {
    const results: Array<
      Effect.Effect<RelayResult, OutboxPublisherError | OutboxStoreError>
    > = [
      Effect.fail(storeUnavailable),
      Effect.fail(publisherUnavailable),
      Effect.fail(publisherUnavailable),
      Effect.succeed({ published: 2, duplicates: 1 }),
    ]
    const outcomes: OutboxRelayCycleOutcome[] = []
    const delays: number[] = []
    const fiber = Effect.runFork(
      runOutboxRelayLoop(config, () => results.shift()!, {
        observe: (outcome) =>
          Effect.sync(() => {
            outcomes.push(outcome)
          }),
        wait: (delayMillis) => {
          delays.push(delayMillis)
          return outcomes.length >= 4 ? Effect.never : Effect.void
        },
      })
    )

    await vi.waitFor(() => expect(outcomes).toHaveLength(4))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(delays).toEqual([100, 200, 250, 1_000])
    expect(outcomes).toEqual([
      {
        _tag: "OutboxRelayCycleFailed",
        reason: "StoreUnavailable",
        consecutiveFailures: 1,
        nextDelayMillis: 100,
      },
      {
        _tag: "OutboxRelayCycleFailed",
        reason: "PublisherUnavailable",
        consecutiveFailures: 2,
        nextDelayMillis: 200,
      },
      {
        _tag: "OutboxRelayCycleFailed",
        reason: "PublisherUnavailable",
        consecutiveFailures: 3,
        nextDelayMillis: 250,
      },
      {
        _tag: "OutboxRelayCycleSucceeded",
        published: 2,
        duplicates: 1,
        consecutiveFailures: 0,
        nextDelayMillis: 1_000,
      },
    ])
  })

  it("distinguishes corrupt outbox data from transient unavailability", async () => {
    const outcomes: OutboxRelayCycleOutcome[] = []
    const failure: OutboxStoreError = {
      _tag: "OutboxStoreFailed",
      operation: "ListPending",
      reason: "CorruptRecord",
    }
    const fiber = Effect.runFork(
      runOutboxRelayLoop(config, () => Effect.fail(failure), {
        observe: (outcome) =>
          Effect.sync(() => {
            outcomes.push(outcome)
          }),
        wait: () => Effect.never,
      })
    )

    await vi.waitFor(() => expect(outcomes).toHaveLength(1))
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(outcomes[0]).toMatchObject({ reason: "CorruptRecord" })
  })
})
