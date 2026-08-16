import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { parseEpisodeCompletedMessage } from "./parse-episode-completed-message.js"

const validMessage = {
  messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
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
}

describe("EpisodeCompleted message parser", () => {
  it("parses envelope then payload into one immutable domain notice", async () => {
    const notice = await Effect.runPromise(
      parseEpisodeCompletedMessage(validMessage)
    )

    expect(notice).toMatchObject({
      messageId: validMessage.messageId,
      episodeId: validMessage.payload.episodeId,
      script: validMessage.payload.script,
      occurredAt: validMessage.occurredAt,
      sources: [{ articleId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40" }],
    })
    expect(Object.isFrozen(notice)).toBe(true)
    expect(Object.isFrozen(notice.sources)).toBe(true)
  })

  it("accepts a queued v2 message published before article provenance was added", async () => {
    const legacyMessage = {
      ...validMessage,
      payload: {
        ...validMessage.payload,
        sources: validMessage.payload.sources.map(
          ({ articleId: _articleId, ...source }) => source
        ),
      },
    }

    const notice = await Effect.runPromise(
      parseEpisodeCompletedMessage(legacyMessage)
    )

    expect(notice.sources).toEqual([
      expect.not.objectContaining({ articleId: expect.anything() }),
    ])
  })

  it.each([
    ["invalid envelope", { ...validMessage, messageId: "message" }],
    [
      "invalid payload",
      { ...validMessage, payload: { ...validMessage.payload, sources: [] } },
    ],
    [
      "untrusted producer",
      {
        ...validMessage,
        producer: "identity-access",
        actor: { _tag: "Service", service: "identity-access" },
      },
    ],
    [
      "mismatched actor",
      {
        ...validMessage,
        actor: { _tag: "Service", service: "content-knowledge" },
      },
    ],
  ])("rejects %s", async (_case, input) => {
    const exit = await Effect.runPromiseExit(
      parseEpisodeCompletedMessage(input)
    )

    expect(exit._tag).toBe("Failure")
  })
})
