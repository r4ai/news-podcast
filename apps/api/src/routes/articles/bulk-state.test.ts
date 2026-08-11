import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"
import { useTemporaryStore } from "../../testing/fixtures.js"

const openStore = useTemporaryStore("news-podcast-api-articles-")

describe("POST /v1/me/articles/bulk-state", () => {
  it("applies only to articles matching the filter, scoped to the owner", async () => {
    const store = openStore()
    const owner = "owner-1"
    const otherOwner = "owner-2"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      { externalId: "a", title: "First", url: "https://example.com/a" },
      { externalId: "b", title: "Second", url: "https://example.com/b" },
      { externalId: "c", title: "Third", url: "https://example.com/c" },
    ])
    const { feed: otherFeed } = store.registerFeed({
      ownerId: otherOwner,
      name: "Other",
      siteUrl: "https://other.example.com",
      feedUrl: "https://other.example.com/feed.xml",
    })
    store.upsertFeedItems(otherFeed.id, [
      {
        externalId: "z",
        title: "Other owner",
        url: "https://other.example.com/z",
      },
    ])
    const [firstArticle] = store.listArticles(owner).items
    store.setArticleState(owner, firstArticle!.id, { read: true })
    const app = createApp({ store, resolveOwner: async () => owner })

    const response = await app.request("/v1/me/articles/bulk-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "unread", read: true }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ updated: 2 })

    const allRead = store
      .listArticles(owner)
      .items.every((article) => article.read)
    expect(allRead).toBe(true)
    expect(
      store.listArticles(otherOwner).items.every((article) => !article.read)
    ).toBe(true)

    store.close()
  })

  it("rejects a body with no state flags", async () => {
    const store = openStore()
    const app = createApp({ store, resolveOwner: async () => "owner-1" })

    const response = await app.request("/v1/me/articles/bulk-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "unread" }),
    })
    expect(response.status).toBe(400)

    store.close()
  })
})
