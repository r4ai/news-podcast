import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  parseAddFeedSubscriptionRequest,
  parseDeleteFeedSubscriptionRequest,
  parseMaterializeArticlesRequest,
  parseMaterializeArticlesReply,
} from "./content-knowledge-rpc.js"

const articleId = "5af55f2e-ff0b-475c-866a-f2cff48c101d"

describe("content knowledge RPC contracts", () => {
  it("accepts canonical subscription CRUD requests", async () => {
    expect(
      await Effect.runPromise(
        parseAddFeedSubscriptionRequest({
          feedUrl: "https://feeds.example.com/news.xml",
        })
      )
    ).toEqual({ feedUrl: "https://feeds.example.com/news.xml" })
    expect(
      await Effect.runPromise(
        parseDeleteFeedSubscriptionRequest({
          subscriptionId: "9aa2225d-07e7-4af4-a8e6-e4788f801a91",
        })
      )
    ).toMatchObject({ subscriptionId: expect.any(String) })
  })

  it("supports automatic and bounded selected materialization", async () => {
    expect(
      await Effect.runPromise(
        parseMaterializeArticlesRequest({
          selection: { _tag: "Automatic" },
        })
      )
    ).toEqual({ selection: { _tag: "Automatic" } })
    expect(
      await Effect.runPromise(
        parseMaterializeArticlesRequest({
          selection: { _tag: "Selected", articleIds: [articleId] },
        })
      )
    ).toMatchObject({ selection: { articleIds: [articleId] } })

    for (const articleIds of [
      [],
      Array.from({ length: 21 }, () => articleId),
      ["article-1"],
    ]) {
      expect(
        (
          await Effect.runPromiseExit(
            parseMaterializeArticlesRequest({
              selection: { _tag: "Selected", articleIds },
            })
          )
        )._tag
      ).toBe("Failure")
    }
  })

  it("bounds Markdown materialization and preserves provenance", async () => {
    const reply = await Effect.runPromise(
      parseMaterializeArticlesReply({
        _tag: "Materialized",
        articles: [
          {
            articleId,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4",
            title: "Stable article",
            url: "https://news.example.com/stable",
            markdown: "# Stable\n\nBody",
            publishedAt: "2026-08-13T00:00:00.000Z",
          },
        ],
      })
    )
    expect(reply._tag).toBe("Materialized")
    if (reply._tag === "Materialized")
      expect(Object.isFrozen(reply.articles)).toBe(true)
  })
})
