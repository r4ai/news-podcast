import { describe, expect, it } from "vitest"
import { computeProfileHash } from "@news-podcast/adapters/ai-enrich/shared"

import { createApp } from "../../app.js"
import {
  seedArchivedArticle,
  useTemporaryStore,
} from "../../testing/fixtures.js"

const openStore = useTemporaryStore("news-podcast-api-articles-")

describe("GET /v1/me/articles", () => {
  it("paginates with cursor and reports hasMore/nextCursor", async () => {
    const store = openStore()
    const owner = "owner-1"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(
      feed.id,
      Array.from({ length: 5 }, (_, index) => ({
        externalId: `item-${index}`,
        title: `Article ${index}`,
        url: `https://example.com/${index}`,
        publishedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      }))
    )
    const app = createApp({ store, resolveOwner: async () => owner })

    const firstResponse = await app.request("/v1/me/articles?limit=2")
    expect(firstResponse.status).toBe(200)
    const first = (await firstResponse.json()) as {
      items: Array<{ id: string }>
      page: { hasMore: boolean; nextCursor?: string }
    }
    expect(first.items).toHaveLength(2)
    expect(first.page.hasMore).toBe(true)
    expect(typeof first.page.nextCursor).toBe("string")

    const secondResponse = await app.request(
      `/v1/me/articles?limit=2&cursor=${encodeURIComponent(first.page.nextCursor!)}`
    )
    const second = (await secondResponse.json()) as {
      items: Array<{ id: string }>
      page: { hasMore: boolean; nextCursor?: string }
    }
    expect(second.items).toHaveLength(2)
    expect(second.page.hasMore).toBe(true)

    const overlap = first.items
      .map((item) => item.id)
      .filter((id) => second.items.some((item) => item.id === id))
    expect(overlap).toEqual([])

    store.close()
  })

  it("filters by q, state, feedIds, and sort", async () => {
    const store = openStore()
    const owner = "owner-1"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "a",
        title: "Weather update",
        url: "https://example.com/a",
        publishedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      },
      {
        externalId: "b",
        title: "Market report",
        url: "https://example.com/b",
        publishedAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
      },
    ])
    const app = createApp({ store, resolveOwner: async () => owner })

    const searched = await app.request("/v1/me/articles?q=Market")
    const searchedBody = (await searched.json()) as {
      items: Array<{ title: string }>
    }
    expect(searchedBody.items.map((item) => item.title)).toEqual([
      "Market report",
    ])

    const byFeed = await app.request(`/v1/me/articles?feedIds=${feed.id}`)
    const byFeedBody = (await byFeed.json()) as { items: unknown[] }
    expect(byFeedBody.items).toHaveLength(2)

    const oldest = await app.request("/v1/me/articles?sort=oldest")
    const oldestBody = (await oldest.json()) as {
      items: Array<{ title: string }>
    }
    expect(oldestBody.items[0]?.title).toBe("Weather update")

    store.close()
  })

  it("isolates by owner and rejects other owners' articles", async () => {
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
      {
        externalId: "a",
        title: "Owner-only article",
        url: "https://example.com/a",
      },
    ])
    const app = createApp({ store, resolveOwner: async () => otherOwner })

    const response = await app.request("/v1/me/articles")
    const body = (await response.json()) as { items: unknown[] }
    expect(body.items).toEqual([])

    store.close()
  })

  it("hides an article by default and includes it back with includeHidden=true", async () => {
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
    const app = createApp({ store, resolveOwner: async () => owner })
    const target = store.listArticles(owner).items[0]!

    const patched = await app.request(`/v1/me/articles/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    })
    expect(patched.status).toBe(200)
    const patchedBody = (await patched.json()) as {
      hidden: boolean
      hiddenAt?: string
    }
    expect(patchedBody.hidden).toBe(true)
    expect(typeof patchedBody.hiddenAt).toBe("string")

    const defaultList = await app.request("/v1/me/articles")
    const defaultBody = (await defaultList.json()) as { items: unknown[] }
    expect(defaultBody.items).toHaveLength(1)

    const includingHidden = await app.request(
      "/v1/me/articles?includeHidden=true"
    )
    const includingHiddenBody = (await includingHidden.json()) as {
      items: unknown[]
    }
    expect(includingHiddenBody.items).toHaveLength(2)

    store.close()
  })

  it("filters by state=later", async () => {
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
    const app = createApp({ store, resolveOwner: async () => owner })
    const target = store.listArticles(owner).items[0]!
    await app.request(`/v1/me/articles/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readLater: true }),
    })

    const response = await app.request("/v1/me/articles?state=later")
    const body = (await response.json()) as { items: Array<{ id: string }> }
    expect(body.items.map((item) => item.id)).toEqual([target.id])

    store.close()
  })

  it("sort=relevance places unscored articles after scored ones and honors minScore", async () => {
    const store = openStore()
    const owner = "owner-articles-relevance"
    const scoredId = seedArchivedArticle(store, owner, "scored")
    seedArchivedArticle(store, owner, "unscored")
    const profileHash = computeProfileHash("", "")
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: scoredId,
      profileHash,
      model: "test-model",
      score: 88,
      reason: "テスト理由",
      tokensIn: 1,
      tokensOut: 1,
    })
    const app = createApp({ store, resolveOwner: async () => owner })

    const response = await app.request("/v1/me/articles?sort=relevance")
    const body = (await response.json()) as {
      items: Array<{ id: string; relevanceScore?: number }>
    }
    expect(body.items[0]?.id).toBe(scoredId)
    expect(body.items[0]?.relevanceScore).toBe(88)
    expect(body.items[1]?.relevanceScore).toBeUndefined()

    const filtered = await app.request("/v1/me/articles?minScore=50")
    const filteredBody = (await filtered.json()) as {
      items: Array<{ id: string }>
    }
    expect(filteredBody.items.map((item) => item.id)).toEqual([scoredId])
    store.close()
  })
})
