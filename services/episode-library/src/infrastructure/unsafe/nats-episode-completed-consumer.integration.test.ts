import { jetstream } from "@nats-io/jetstream"
import { connect } from "@nats-io/transport-node"
import { subjects } from "@news-podcast/protocols"
import { describe, expect, it } from "vitest"

import { connectEpisodeCompletedConsumerUnsafe } from "./nats-episode-completed-consumer.js"

const server = process.env.NATS_TEST_URL
const within = async <A>(label: string, promise: Promise<A>): Promise<A> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out: ${label}`)), 2_000)
    ),
  ])

describe.runIf(server)(
  "JetStream EpisodeCompleted consumer integration",
  () => {
    it("creates a filtered durable, nacks for redelivery, and persists ack state", async () => {
      const stream = "EPISODE_LIBRARY_INTEGRATION"
      const durableName = "episode-library-integration"
      const connection = await connect({ servers: [server!] })
      const client = jetstream(connection)
      const manager = await client.jetstreamManager()
      await manager.streams.add({
        name: stream,
        subjects: [subjects.production.jobCompletedV2],
      })

      const consumer = await within(
        "connect consumer",
        connectEpisodeCompletedConsumerUnsafe({
          servers: [server!],
          stream,
          durableName,
          ackWaitMillis: 5_000,
          maximumDeliveries: 3,
        })
      )
      try {
        await client.publish(
          subjects.production.jobCompletedV2,
          new TextEncoder().encode("payload")
        )
        const first = await within("first receive", consumer.receive())
        expect(first?.deliveryCount).toBe(1)
        await first?.nack(10)

        const second = await within("second receive", consumer.receive())
        expect(second?.deliveryCount).toBe(2)
        await second?.ack()
        await connection.flush()

        const info = await manager.consumers.info(stream, durableName)
        expect(info.config).toMatchObject({
          durable_name: durableName,
          filter_subject: subjects.production.jobCompletedV2,
          max_deliver: 3,
          max_ack_pending: 1,
        })
      } finally {
        await within("consumer drain", consumer.drain())
        await manager.streams.delete(stream).catch(() => false)
        await connection.drain()
      }
    }, 20_000)
  }
)
