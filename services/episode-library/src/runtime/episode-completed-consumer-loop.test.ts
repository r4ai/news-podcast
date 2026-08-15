import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { EpisodeCompletionPorts } from "../application/ports/completion.js"
import type {
  UnsafeEpisodeCompletedConsumer,
  UnsafeEpisodeCompletedDelivery,
} from "../infrastructure/unsafe/nats-episode-completed-consumer.js"
import {
  runEpisodeCompletedConsumerLoop,
  type EpisodeCompletedConsumerOutcome,
} from "./episode-completed-consumer-loop.js"

const invalidDelivery = (
  events: string[],
  deliveryCount: number
): UnsafeEpisodeCompletedDelivery => ({
  data: new TextEncoder().encode("not-json"),
  deliveryCount,
  ack: async () => void events.push("ack"),
  nack: async (delayMillis) => void events.push(`nack:${delayMillis}`),
})

const ports: EpisodeCompletionPorts = {
  materialize: vi.fn(),
  saveOnce: vi.fn(),
}

describe("EpisodeCompleted durable consumer loop", () => {
  it("nacks with bounded exponential backoff and continues receiving", async () => {
    const events: string[] = []
    const deliveries = [invalidDelivery(events, 1), invalidDelivery(events, 8)]
    const outcomes: EpisodeCompletedConsumerOutcome[] = []
    const consumer: UnsafeEpisodeCompletedConsumer = {
      receive: async () => deliveries.shift(),
      drain: async () => void events.push("drain"),
    }

    await Effect.runPromise(
      runEpisodeCompletedConsumerLoop(consumer, ports, {
        initialNackDelayMillis: 500,
        maximumNackDelayMillis: 2_000,
        observe: (outcome) => Effect.sync(() => void outcomes.push(outcome)),
      })
    )

    expect(events).toEqual(["nack:500", "nack:2000"])
    expect(outcomes).toEqual([
      expect.objectContaining({
        _tag: "EpisodeCompletedNacked",
        delayMillis: 500,
      }),
      expect.objectContaining({
        _tag: "EpisodeCompletedNacked",
        delayMillis: 2_000,
      }),
    ])
  })

  it("fails fast on consumer receive and acknowledgement I/O failures", async () => {
    const receiveExit = await Effect.runPromiseExit(
      runEpisodeCompletedConsumerLoop(
        {
          receive: () => Promise.reject(new Error("connection closed")),
          drain: async () => undefined,
        },
        ports,
        { initialNackDelayMillis: 500, maximumNackDelayMillis: 2_000 }
      )
    )
    expect(receiveExit._tag).toBe("Failure")

    const nackExit = await Effect.runPromiseExit(
      runEpisodeCompletedConsumerLoop(
        {
          receive: async () => ({
            ...invalidDelivery([], 1),
            nack: () => Promise.reject(new Error("nack failed")),
          }),
          drain: async () => undefined,
        },
        ports,
        { initialNackDelayMillis: 500, maximumNackDelayMillis: 2_000 }
      )
    )
    expect(nackExit._tag).toBe("Failure")
  })
})
