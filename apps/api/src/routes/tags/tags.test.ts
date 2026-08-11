import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"
import { json, useTemporaryStore } from "../../testing/fixtures.js"

const openStore = useTemporaryStore("news-podcast-api-tags-")

describe("タグAPI", () => {
  it("creates, lists, and deletes a tag for the authenticated owner", async () => {
    const store = openStore()
    const owner = "owner-1"
    const app = createApp({ store, resolveOwner: async () => owner })

    const created = await app.request("/v1/me/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "AI" }),
    })
    expect(created.status).toBe(201)
    const tag = await json<{ id: string; name: string }>(created)
    expect(tag.name).toBe("AI")

    const listed = await json<{ items: { id: string }[] }>(
      await app.request("/v1/me/tags")
    )
    expect(listed.items.map((item) => item.id)).toEqual([tag.id])

    const deleted = await app.request(`/v1/me/tags/${tag.id}`, {
      method: "DELETE",
    })
    expect(deleted.status).toBe(204)
    const afterDelete = await json<{ items: unknown[] }>(
      await app.request("/v1/me/tags")
    )
    expect(afterDelete.items).toHaveLength(0)
    store.close()
  })

  it("does not let one owner see or delete another owner's tags (owner isolation)", async () => {
    const store = openStore()
    const app = createApp({ store, resolveOwner: async () => "owner-a" })
    const otherApp = createApp({ store, resolveOwner: async () => "owner-b" })

    const created = await json<{ id: string }>(
      await app.request("/v1/me/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "AI" }),
      })
    )

    const otherList = await json<{ items: unknown[] }>(
      await otherApp.request("/v1/me/tags")
    )
    expect(otherList.items).toHaveLength(0)

    const otherDelete = await otherApp.request(`/v1/me/tags/${created.id}`, {
      method: "DELETE",
    })
    expect(otherDelete.status).toBe(404)

    const stillThere = await json<{ items: unknown[] }>(
      await app.request("/v1/me/tags")
    )
    expect(stillThere.items).toHaveLength(1)
    store.close()
  })

  it("sets manual tags via PUT and reflects them on the article and in tag-filtered listing with pagination", async () => {
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
      Array.from({ length: 6 }, (_, index) => ({
        externalId: `item-${index}`,
        title: `Article ${index}`,
        url: `https://example.com/${index}`,
        publishedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      }))
    )
    const app = createApp({ store, resolveOwner: async () => owner })
    const tag = store.createTag(owner, "AI")

    const articles = await json<{ items: { id: string }[] }>(
      await app.request("/v1/me/articles?limit=6")
    )
    const taggedIds = articles.items
      .filter((_, index) => index % 2 === 0)
      .map((item) => item.id)

    for (const id of taggedIds) {
      const response = await app.request(`/v1/me/articles/${id}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: [tag.id] }),
      })
      expect(response.status).toBe(200)
      const body = await json<{ tags: string[] }>(response)
      expect(body.tags).toEqual(["AI"])
    }

    // タグ絞り込み + ページネーションを併用しても対象集合がぶれないこと。
    const seen = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const url = new URL("https://x/v1/me/articles")
      url.searchParams.set("limit", "2")
      url.searchParams.set("tagIds", tag.id)
      if (cursor) url.searchParams.set("cursor", cursor)
      const page = await json<{
        items: { id: string }[]
        page: { hasMore: boolean; nextCursor?: string }
      }>(await app.request(url.pathname + url.search))
      for (const item of page.items) seen.add(item.id)
      if (!page.page.hasMore) break
      cursor = page.page.nextCursor
    }
    expect([...seen].sort()).toEqual([...taggedIds].sort())
    store.close()
  })

  it("lists tag suggestions and promotes one into a real vocabulary tag", async () => {
    const store = openStore()
    const owner = "owner-1"
    store.recordTagSuggestions(owner, ["新語彙"])
    const app = createApp({ store, resolveOwner: async () => owner })

    const suggestions = await json<{ items: { name: string }[] }>(
      await app.request("/v1/me/tag-suggestions")
    )
    expect(suggestions.items.map((item) => item.name)).toEqual(["新語彙"])

    const promoted = await app.request("/v1/me/tag-suggestions/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "新語彙" }),
    })
    expect(promoted.status).toBe(201)

    const afterPromote = await json<{ items: unknown[] }>(
      await app.request("/v1/me/tag-suggestions")
    )
    expect(afterPromote.items).toHaveLength(0)
    const tags = await json<{ items: { name: string }[] }>(
      await app.request("/v1/me/tags")
    )
    expect(tags.items.map((item) => item.name)).toEqual(["新語彙"])
    store.close()
  })

  it("returns 404 when promoting a suggestion that does not exist", async () => {
    const store = openStore()
    const app = createApp({
      store,
      resolveOwner: async () => "owner-1",
    })
    const response = await app.request("/v1/me/tag-suggestions/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "no-such" }),
    })
    expect(response.status).toBe(404)
    store.close()
  })
})
