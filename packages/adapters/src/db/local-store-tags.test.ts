import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { LocalStore } from "./local-store.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function openStore(): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), "news-podcast-tags-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

function seedFeed(store: LocalStore, owner: string, name: string, count: number) {
  const { feed } = store.registerFeed({
    ownerId: owner,
    name,
    siteUrl: `https://${name}.example.com`,
    feedUrl: `https://${name}.example.com/feed.xml`,
  })
  store.upsertFeedItems(
    feed.id,
    Array.from({ length: count }, (_, index) => ({
      externalId: `${name}-${index}`,
      title: `${name} article ${index}`,
      url: `https://${name}.example.com/${index}`,
      publishedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    }))
  )
  return store.listArticles(owner, { limit: 100 }).items.map((item) => item.id)
}

describe("LocalStore タグCRUDとowner isolation", () => {
  it("keeps tags scoped per owner (same name allowed for different owners, independent ids)", () => {
    const store = openStore()
    const tagA = store.createTag("owner-a", "AI")
    const tagB = store.createTag("owner-b", "AI")
    expect(tagA.id).not.toBe(tagB.id)
    expect(store.listTags("owner-a").map((t) => t.name)).toEqual(["AI"])
    expect(store.listTags("owner-b").map((t) => t.name)).toEqual(["AI"])
    store.close()
  })

  it("is idempotent when creating a tag with an existing name for the same owner", () => {
    const store = openStore()
    const first = store.createTag("owner-a", "AI")
    const second = store.createTag("owner-a", "AI")
    expect(second.id).toBe(first.id)
    expect(store.listTags("owner-a")).toHaveLength(1)
    store.close()
  })

  it("only deletes a tag that belongs to the requesting owner", () => {
    const store = openStore()
    const tag = store.createTag("owner-a", "AI")
    expect(store.deleteTag("owner-b", tag.id)).toBe(false)
    expect(store.deleteTag("owner-a", tag.id)).toBe(true)
    expect(store.listTags("owner-a")).toHaveLength(0)
    store.close()
  })

  it("does not leak manual tag assignment across owners on the same shared article", () => {
    const store = openStore()
    const [articleId] = seedFeed(store, "owner-a", "shared", 1)
    store.ensureDefaultSubscriptions("owner-b") // no-op safety check, unrelated feed set
    const tag = store.createTag("owner-a", "AI")
    store.setArticleManualTags("owner-a", articleId!, [tag.id])
    expect(store.getArticle("owner-a", articleId!)?.tags).toEqual(["AI"])
    // owner-bは同じ記事を購読していないのでgetArticleはundefinedになるが、
    // article_tags側もowner_idで隔離されていることをSQLで直接確認する。
    const rows = store.database
      .prepare("SELECT owner_id FROM article_tags WHERE feed_item_id = ?")
      .all(articleId!) as { owner_id: string }[]
    expect(rows.every((row) => row.owner_id === "owner-a")).toBe(true)
    store.close()
  })
})

describe("LocalStore PUT記事タグ（手動）", () => {
  it("replaces the manual tag set without touching AI-assigned tags", () => {
    const store = openStore()
    const owner = "owner-a"
    const [articleId] = seedFeed(store, owner, "feed", 1)
    const manual1 = store.createTag(owner, "手動1")
    const manual2 = store.createTag(owner, "手動2")
    const aiTag = store.createTag(owner, "AI")

    store.setArticleManualTags(owner, articleId!, [manual1.id])
    store.saveAiArticleTags(owner, articleId!, [{ name: "AI", confidence: 1 }])
    expect([...(store.getArticle(owner, articleId!)?.tags ?? [])].sort()).toEqual(
      ["AI", "手動1"].sort()
    )

    store.setArticleManualTags(owner, articleId!, [manual2.id])
    expect([...(store.getArticle(owner, articleId!)?.tags ?? [])].sort()).toEqual(
      ["AI", "手動2"].sort()
    )
    expect(aiTag.id).toBeDefined()
    store.close()
  })
})

describe("LocalStore タグ絞り込み + ページネーション", () => {
  it("filters listArticles by tagIds and keeps keyset pagination stable across pages", () => {
    const store = openStore()
    const owner = "owner-a"
    const ids = seedFeed(store, owner, "feed", 20)
    const tag = store.createTag(owner, "対象")
    const taggedIds = ids.filter((_, index) => index % 2 === 0)
    for (const id of taggedIds) {
      store.setArticleManualTags(owner, id, [tag.id])
    }

    const seen = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const page = store.listArticles(owner, {
        limit: 3,
        tagIds: [tag.id],
        ...(cursor ? { cursor } : {}),
      })
      for (const item of page.items) {
        expect(taggedIds).toContain(item.id)
        seen.add(item.id)
      }
      if (!page.hasMore) break
      cursor = page.nextCursor
    }
    expect(seen.size).toBe(taggedIds.length)
    store.close()
  })
})

describe("LocalStore タグ提案", () => {
  it("accumulates occurrences for a repeated suggestion and removes it once promoted", () => {
    const store = openStore()
    const owner = "owner-a"
    store.recordTagSuggestions(owner, ["新語彙"])
    store.recordTagSuggestions(owner, ["新語彙", "別案"])
    const suggestions = store.listTagSuggestions(owner)
    expect(suggestions.find((s) => s.name === "新語彙")?.occurrences).toBe(2)
    expect(suggestions.find((s) => s.name === "別案")?.occurrences).toBe(1)

    const promoted = store.promoteTagSuggestion(owner, "新語彙")
    expect(promoted?.name).toBe("新語彙")
    expect(store.listTags(owner).map((t) => t.name)).toContain("新語彙")
    expect(
      store.listTagSuggestions(owner).some((s) => s.name === "新語彙")
    ).toBe(false)
    store.close()
  })

  it("returns undefined when promoting a suggestion that does not exist", () => {
    const store = openStore()
    expect(store.promoteTagSuggestion("owner-a", "no-such")).toBeUndefined()
    store.close()
  })
})
