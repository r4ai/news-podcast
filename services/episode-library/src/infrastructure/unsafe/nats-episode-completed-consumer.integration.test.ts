import { jetstream } from "@nats-io/jetstream"
import { connect } from "@nats-io/transport-node"
import { subjects } from "@news-podcast/protocols"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import type { EpisodeCompletionPorts } from "../../application/ports/completion.js"
import {
  runEpisodeCompletedConsumerLoop,
  type EpisodeCompletedConsumerOutcome,
} from "../../runtime/episode-completed-consumer-loop.js"
import { connectEpisodeCompletedConsumerUnsafe } from "./nats-episode-completed-consumer.js"

const server = process.env.NATS_TEST_URL
const within = async <A>(label: string, promise: Promise<A>): Promise<A> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out: ${label}`)), 2_000)
    ),
  ])

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

describe.runIf(server)(
  "JetStream EpisodeCompleted consumer integration",
  () => {
    it("materializes the episode after persistence recovers beyond the alert threshold", async () => {
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
        })
      )
      try {
        let saves = 0
        let stopAfterAcknowledgement = false
        let persistedEpisodeId: string | undefined
        const outcomes: EpisodeCompletedConsumerOutcome[] = []
        const recoveringPorts: EpisodeCompletionPorts = {
          materialize: (notice) =>
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
            } as never),
          saveOnce: (_messageId, episode) => {
            saves += 1
            if (saves <= 3) {
              return Effect.fail({
                _tag: "CompletionStoreFailure" as const,
                operation: "save" as const,
              })
            }
            persistedEpisodeId = episode.id
            return Effect.succeed("Stored" as const)
          },
        }

        await client.publish(subjects.production.jobCompletedV2, validMessage)
        await within(
          "completion recovery",
          Effect.runPromise(
            runEpisodeCompletedConsumerLoop(
              {
                receive: () =>
                  stopAfterAcknowledgement
                    ? Promise.resolve(undefined)
                    : consumer.receive(),
                drain: consumer.drain,
              },
              recoveringPorts,
              {
                maximumDeliveries: 3,
                initialNackDelayMillis: 10,
                maximumNackDelayMillis: 10,
                observe: (outcome) =>
                  Effect.sync(() => {
                    outcomes.push(outcome)
                    if (outcome._tag === "EpisodeCompletedAcknowledged") {
                      stopAfterAcknowledgement = true
                    }
                  }),
              }
            )
          )
        )

        expect(persistedEpisodeId).toBe("5af55f2e-ff0b-475c-866a-f2cff48c101d")
        expect(outcomes.map((outcome) => outcome._tag)).toEqual([
          "EpisodeCompletedNacked",
          "EpisodeCompletedNacked",
          "EpisodeCompletedRedeliveryThresholdExceeded",
          "EpisodeCompletedAcknowledged",
        ])
        expect(outcomes.map((outcome) => outcome.deliveryCount)).toEqual([
          1, 2, 3, 4,
        ])

        const info = await manager.consumers.info(stream, durableName)
        expect(info.config).toMatchObject({
          durable_name: durableName,
          filter_subject: subjects.production.jobCompletedV2,
          max_deliver: -1,
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
