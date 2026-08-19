import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import type { EpisodeCompletionPorts } from "../application/ports/completion.js"
import type {
  UnsafeEpisodeCompletedConsumer,
  UnsafeEpisodeCompletedDelivery,
} from "../infrastructure/unsafe/nats-episode-completed-consumer.js"
import {
  runEpisodeCompletedConsumerLoop,
  type EpisodeCompletedConsumerOutcome,
} from "./episode-completed-consumer-loop.js"

const validDelivery = (
  events: string[],
  deliveryCount: number
): UnsafeEpisodeCompletedDelivery => ({
  data: validMessage,
  deliveryCount,
  ack: async () => void events.push("ack"),
  nack: async (delayMillis) => void events.push(`nack:${delayMillis}`),
})

const validMessage = new TextEncoder().encode(
  JSON.stringify({
    messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
    correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3a40",
    causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
    occurredAt: "2026-08-12T00:00:00.000Z",
    producer: "episode-production",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    actor: { _tag: "Service", service: "episode-production" },
    payload: {
      episodeId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
      ownerId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
      title: "Daily news",
      script: "Full script",
      audio: {
        objectKey: "episodes/user/episode.wav",
        byteLength: 42,
        contentType: "audio/wav",
      },
      sources: [
        {
          sourceKind: "rss",
          articleId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
          snapshotId: "06c0200a-e447-4243-b5e7-f31e7464f2e4",
          url: "https://example.com/news/1",
          title: "News 1",
        },
      ],
      completedAt: "2026-08-12T00:00:00.000Z",
    },
  })
)

const materializeMatchingEpisode: EpisodeCompletionPorts["materialize"] = (
  notice
) =>
  Effect.succeed({
    id: notice.episodeId,
    ownerId: notice.ownerId,
    title: notice.title,
    script: notice.script,
    audio: notice.audio,
    createdAt: notice.completedAt,
    sources: notice.sources.map((source) => ({
      ...source,
      _tag: "RssSource" as const,
    })),
  } as never)

const failingStorePorts: EpisodeCompletionPorts = {
  materialize: materializeMatchingEpisode,
  saveOnce: () =>
    Effect.fail({
      _tag: "CompletionStoreFailure" as const,
      operation: "save" as const,
    }),
}

describe("EpisodeCompleted durable consumer loop", () => {
  it("nacks with bounded exponential backoff and continues receiving", async () => {
    const events: string[] = []
    const deliveries = [validDelivery(events, 1), validDelivery(events, 8)]
    const outcomes: EpisodeCompletedConsumerOutcome[] = []
    const consumer: UnsafeEpisodeCompletedConsumer = {
      receive: async () => deliveries.shift(),
      drain: async () => void events.push("drain"),
    }

    await Effect.runPromise(
      runEpisodeCompletedConsumerLoop(consumer, failingStorePorts, {
        maximumDeliveries: 10,
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

  it("fails fast on consumer receive and nack I/O failures", async () => {
    const receiveExit = await Effect.runPromiseExit(
      runEpisodeCompletedConsumerLoop(
        {
          receive: () => Promise.reject(new Error("connection closed")),
          drain: async () => undefined,
        },
        failingStorePorts,
        {
          maximumDeliveries: 3,
          initialNackDelayMillis: 500,
          maximumNackDelayMillis: 2_000,
        }
      )
    )
    expect(receiveExit._tag).toBe("Failure")

    const nackExit = await Effect.runPromiseExit(
      runEpisodeCompletedConsumerLoop(
        {
          receive: async () => ({
            ...validDelivery([], 1),
            nack: () => Promise.reject(new Error("nack failed")),
          }),
          drain: async () => undefined,
        },
        failingStorePorts,
        {
          maximumDeliveries: 3,
          initialNackDelayMillis: 500,
          maximumNackDelayMillis: 2_000,
        }
      )
    )
    expect(nackExit._tag).toBe("Failure")
  })

  it("recovers after persistence fails beyond the redelivery threshold", async () => {
    const events: string[] = []
    const outcomes: EpisodeCompletedConsumerOutcome[] = []
    const deliveries = [1, 2, 3, 4].map((deliveryCount) => ({
      data: validMessage,
      deliveryCount,
      ack: async () => void events.push(`ack:${deliveryCount}`),
      nack: async () => void events.push(`nack:${deliveryCount}`),
    }))
    let saves = 0
    const recoveringPorts: EpisodeCompletionPorts = {
      materialize: materializeMatchingEpisode,
      saveOnce: () => {
        saves += 1
        return saves <= 3
          ? Effect.fail({
              _tag: "CompletionStoreFailure" as const,
              operation: "save" as const,
            })
          : Effect.succeed("Stored" as const)
      },
    }

    await Effect.runPromise(
      runEpisodeCompletedConsumerLoop(
        {
          receive: async () => deliveries.shift(),
          drain: async () => undefined,
        },
        recoveringPorts,
        {
          maximumDeliveries: 3,
          initialNackDelayMillis: 1,
          maximumNackDelayMillis: 4,
          observe: (outcome) => Effect.sync(() => void outcomes.push(outcome)),
        }
      )
    )

    expect(events).toEqual(["nack:1", "nack:2", "nack:3", "ack:4"])
    expect(outcomes.map((outcome) => outcome._tag)).toEqual([
      "EpisodeCompletedNacked",
      "EpisodeCompletedNacked",
      "EpisodeCompletedRedeliveryThresholdExceeded",
      "EpisodeCompletedAcknowledged",
    ])
  })
})
