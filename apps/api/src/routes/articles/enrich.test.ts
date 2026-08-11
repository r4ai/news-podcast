import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"
import {
  seedArchivedArticle,
  useTemporaryStore,
} from "../../testing/fixtures.js"

const openStore = useTemporaryStore("news-podcast-api-ai-enrich-")

describe("POST /v1/me/articles/{id}/enrich", () => {
  it("returns 503 when no enrichArticle dependency is wired", async () => {
    const store = openStore()
    const owner = "owner-no-enrich"
    const id = seedArchivedArticle(store, owner, "no-enrich")
    const app = createApp({ store, resolveOwner: async () => owner })

    const response = await app.request(`/v1/me/articles/${id}/enrich`, {
      method: "POST",
    })
    expect(response.status).toBe(503)
    store.close()
  })

  it("returns 503 when the AI provider fails", async () => {
    const store = openStore()
    const owner = "owner-enrich-provider-failure"
    const id = seedArchivedArticle(store, owner, "provider-failure")
    const app = createApp({
      store,
      resolveOwner: async () => owner,
      enrichArticle: () => Promise.reject(new Error("provider secret detail")),
    })

    const response = await app.request(`/v1/me/articles/${id}/enrich`, {
      method: "POST",
    })

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("provider secret detail")
    store.close()
  })

  it("returns 404 for another owner's article even if enrichArticle is wired", async () => {
    const store = openStore()
    const owner = "owner-enrich-a"
    const id = seedArchivedArticle(store, "owner-enrich-b", "isolated")
    const app = createApp({
      store,
      resolveOwner: async () => owner,
      enrichArticle: async () => true,
    })

    const response = await app.request(`/v1/me/articles/${id}/enrich`, {
      method: "POST",
    })
    expect(response.status).toBe(404)
    store.close()
  })

  it("returns 409 when the recompute reports the article is not archived yet", async () => {
    const store = openStore()
    const owner = "owner-enrich-pending"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "feed",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      { externalId: "pending", title: "t", url: "https://example.com/p" },
    ])
    const pending = store.listArticles(owner).items[0]!
    const app = createApp({
      store,
      resolveOwner: async () => owner,
      enrichArticle: async () => false,
    })

    const response = await app.request(`/v1/me/articles/${pending.id}/enrich`, {
      method: "POST",
    })
    expect(response.status).toBe(409)
    store.close()
  })

  it("returns the refreshed article with an updated score on success", async () => {
    const store = openStore()
    const owner = "owner-enrich-ok"
    const id = seedArchivedArticle(store, owner, "ok")
    const profileHash = "profile-hash"
    const app = createApp({
      store,
      resolveOwner: async () => owner,
      enrichArticle: async (ownerId, articleId) => {
        store.saveArticleRelevance({
          ownerId,
          feedItemId: articleId,
          profileHash,
          model: "test-model",
          score: 63,
          reason: "オンデマンド再計算",
          tokensIn: 5,
          tokensOut: 5,
        })
        return true
      },
    })

    const response = await app.request(`/v1/me/articles/${id}/enrich`, {
      method: "POST",
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      relevanceScore?: number
      relevanceReason?: string
    }
    expect(body.relevanceScore).toBe(63)
    expect(body.relevanceReason).toBe("オンデマンド再計算")
    store.close()
  })
})
