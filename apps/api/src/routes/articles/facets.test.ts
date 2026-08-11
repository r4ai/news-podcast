import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"
import { useTemporaryStore } from "../../testing/fixtures.js"

const openStore = useTemporaryStore("news-podcast-api-articles-")

describe("GET /v1/me/articles/facets", () => {
  it("returns state and per-feed counts", async () => {
    const store = openStore()
    const owner = "owner-1"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      { externalId: "a", title: "First", url: "https://example.com/a" },
      { externalId: "b", title: "Second", url: "https://example.com/b" },
    ])
    const [firstArticle] = store.listArticles(owner).items
    store.setArticleState(owner, firstArticle!.id, { saved: true })
    const app = createApp({ store, resolveOwner: async () => owner })

    const response = await app.request("/v1/me/articles/facets")
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      states: { all: number; unread: number; saved: number }
      feeds: Array<{ feedId: string; name: string; count: number }>
    }
    expect(body.states).toEqual({ all: 2, unread: 2, saved: 1, later: 0 })
    expect(body.feeds).toEqual([{ feedId: feed.id, name: "Example", count: 2 }])

    store.close()
  })
})
