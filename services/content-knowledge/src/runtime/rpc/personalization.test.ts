import { MessageEnvelopeSchema, subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import { makePersonalizationRpcHandler } from "./personalization.js"

const articleId = "5af55f2e-ff0b-475c-866a-f2cff48c101d"
const tagId = "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
const envelope = (payload: unknown) =>
  JSON.stringify({
    messageId: "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4",
    correlationId: "ea122752-73d0-4851-9664-7d3e63e76859",
    causationId: "8fb12955-2175-4675-be63-e42227d5ed19",
    occurredAt: "2026-08-13T01:00:00.000Z",
    producer: "gateway",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    actor: { _tag: "User", userId: "owner-a" },
    payload,
  })

describe("personalization RPC", () => {
  it("scopes article tags and enrichment to the actor owner", async () => {
    const listArticleTags = vi.fn(() => Effect.succeed([]))
    const setArticleTags = vi.fn(() =>
      Effect.succeed({ _tag: "Updated" as const, tags: [] })
    )
    const enqueueOne = vi.fn(() =>
      Effect.succeed({ _tag: "Enqueued" as const })
    )
    const handler = makePersonalizationRpcHandler(
      {
        taxonomy: { listArticleTags, setArticleTags } as never,
        interestProfiles: {} as never,
        enrichment: { enqueueOne } as never,
      },
      {
        newMessageId: () => "00508c91-8d8a-452f-82d3-fc621faea801",
        now: () => "2026-08-13T01:00:00.000Z",
      }
    )

    const replies: unknown[] = []
    for (const payload of [
      { operation: "ListArticleTags", articleId },
      { operation: "SetArticleTags", articleId, tagIds: [tagId] },
      { operation: "EnrichArticle", articleId },
    ]) {
      await Effect.runPromise(
        handler({
          subject: subjects.content.personalization,
          payload: envelope(payload),
          reply: (wire) =>
            Effect.sync(() =>
              replies.push(
                Schema.decodeUnknownSync(MessageEnvelopeSchema)(
                  JSON.parse(wire)
                ).payload
              )
            ),
        })
      )
    }

    expect(listArticleTags).toHaveBeenCalledWith("owner-a", articleId)
    expect(setArticleTags).toHaveBeenCalledWith("owner-a", articleId, [tagId])
    expect(enqueueOne).toHaveBeenCalledWith("owner-a", articleId)
    expect(replies).toEqual([
      { _tag: "ArticleTags", tags: [] },
      { _tag: "ArticleTags", tags: [] },
      { _tag: "Enqueued", count: 1 },
    ])
  })
})
