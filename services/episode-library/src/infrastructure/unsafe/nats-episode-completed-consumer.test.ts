import { subjects } from "@news-podcast/protocols"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  jetstream: vi.fn(),
}))

vi.mock("@nats-io/transport-node", () => ({ connect: sdk.connect }))
vi.mock("@nats-io/jetstream", () => ({
  AckPolicy: { Explicit: "explicit" },
  DeliverPolicy: { All: "all" },
  ReplayPolicy: { Instant: "instant" },
  jetstream: sdk.jetstream,
}))

import { connectEpisodeCompletedConsumerUnsafe } from "./nats-episode-completed-consumer.js"

const config = {
  servers: ["nats://127.0.0.1:4222"],
  stream: "EPISODE_PRODUCTION",
  durableName: "episode-library-completions",
  ackWaitMillis: 30_000,
}

beforeEach(() => vi.clearAllMocks())

describe("unsafe JetStream EpisodeCompleted boundary", () => {
  it("creates the durable pull consumer and adapts SDK ack/nack delivery", async () => {
    const ack = vi.fn()
    const nack = vi.fn()
    const message = {
      data: new TextEncoder().encode("payload"),
      info: { deliveryCount: 3 },
      ack,
      nak: nack,
    }
    const next = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: message })
      .mockResolvedValueOnce({ done: true })
    const closeMessages = vi.fn(async () => undefined)
    const messages = {
      [Symbol.asyncIterator]: () => ({ next }),
      close: closeMessages,
    }
    const consume = vi.fn(async () => messages)
    const get = vi.fn(async () => ({ consume }))
    const add = vi.fn(async () => undefined)
    const info = vi.fn(async () => {
      throw new Error("consumer not found")
    })
    const drain = vi.fn(async () => undefined)
    sdk.connect.mockResolvedValue({
      close: vi.fn(async () => undefined),
      drain,
    })
    sdk.jetstream.mockReturnValue({
      jetstreamManager: async () => ({ consumers: { add, info } }),
      consumers: { get },
    })

    const consumer = await connectEpisodeCompletedConsumerUnsafe(config)
    const delivery = await consumer.receive()
    await delivery?.nack(4_000)
    await delivery?.ack()

    expect(add).toHaveBeenCalledWith(config.stream, {
      name: config.durableName,
      durable_name: config.durableName,
      ack_policy: "explicit",
      deliver_policy: "all",
      replay_policy: "instant",
      filter_subject: subjects.production.jobCompletedV2,
      ack_wait: 30_000_000_000,
      max_deliver: -1,
      max_ack_pending: 1,
    })
    expect(get).toHaveBeenCalledWith(config.stream, config.durableName)
    expect(consume).toHaveBeenCalledWith({
      max_messages: 1,
      abort_on_missing_resource: true,
    })
    expect(nack).toHaveBeenCalledWith(4_000)
    expect(ack).toHaveBeenCalledOnce()
    expect(await consumer.receive()).toBeUndefined()

    await consumer.drain()
    await consumer.drain()
    expect(closeMessages).toHaveBeenCalledOnce()
    expect(drain).toHaveBeenCalledOnce()
  })

  it("reuses an existing durable pull consumer after a service restart", async () => {
    const messages = {
      [Symbol.asyncIterator]: () => ({
        next: vi.fn(async () => ({ done: true })),
      }),
      close: vi.fn(async () => undefined),
    }
    const consume = vi.fn(async () => messages)
    const get = vi.fn(async () => ({ consume }))
    const add = vi.fn(async () => undefined)
    const info = vi.fn(async () => ({ name: config.durableName }))
    sdk.connect.mockResolvedValue({
      close: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
    })
    sdk.jetstream.mockReturnValue({
      jetstreamManager: async () => ({ consumers: { add, info } }),
      consumers: { get },
    })

    const consumer = await connectEpisodeCompletedConsumerUnsafe(config)

    expect(info).toHaveBeenCalledWith(config.stream, config.durableName)
    expect(add).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith(config.stream, config.durableName)
    await consumer.drain()
  })

  it("closes an acquired connection when JetStream setup fails", async () => {
    const close = vi.fn(async () => undefined)
    sdk.connect.mockResolvedValue({ close, drain: vi.fn() })
    sdk.jetstream.mockReturnValue({
      jetstreamManager: () => Promise.reject(new Error("JetStream disabled")),
    })

    await expect(connectEpisodeCompletedConsumerUnsafe(config)).rejects.toThrow(
      "JetStream disabled"
    )
    expect(close).toHaveBeenCalledOnce()
  })
})
