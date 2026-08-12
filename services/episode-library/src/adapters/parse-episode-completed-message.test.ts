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
    audioObjectKey: "episodes/user/episode.wav",
    title: "Daily news",
    sources: [{ url: "https://example.com/news/1", title: "News 1" }],
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
      occurredAt: validMessage.occurredAt,
    })
    expect(Object.isFrozen(notice)).toBe(true)
    expect(Object.isFrozen(notice.sources)).toBe(true)
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
