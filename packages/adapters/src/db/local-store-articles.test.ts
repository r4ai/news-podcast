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
  const directory = mkdtempSync(join(tmpdir(), "news-podcast-articles-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

// owner を購読させ、feedごとに連番付きのpublished_atで記事を作る。
function seedFeed(
  store: LocalStore,
  owner: string,
  name: string,
  count: number,
  startHour: number
) {
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
      publishedAt: new Date(
        Date.UTC(2026, 0, 1, startHour + index)
      ).toISOString(),
      summary: index % 5 === 0 ? "quarterly earnings report" : "general news",
    }))
  )
  return feed
}

describe("LocalStore.listArticles pagination", () => {
  it("walks all pages via cursor without duplicates or gaps, hasMore false on last page", () => {
    const store = openStore()
    const owner = "owner-a"
    const feed = seedFeed(store, owner, "alpha", 27, 0)

    const seen = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    for (;;) {
      const page = store.listArticles(owner, {
        limit: 7,
        ...(cursor ? { cursor } : {}),
      })
      pages += 1
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false)
        seen.add(item.id)
      }
      if (!page.hasMore) {
        expect(page.nextCursor).toBeUndefined()
        break
      }
      expect(page.nextCursor).toBeDefined()
      cursor = page.nextCursor
      // 安全弁: 無限ループ化を防ぐ
      expect(pages).toBeLessThan(20)
    }

    expect(seen.size).toBe(27)
    expect(pages).toBe(Math.ceil(27 / 7))
    expect([...seen].sort()).toEqual(
      store
        .listArticles(owner, { limit: 100 })
        .items.map((item) => item.id)
        .sort()
    )
    expect(feed.id).toBeDefined()
    store.close()
  })

  it("reports hasMore true mid-walk and false once limit exactly exhausts remaining rows", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "beta", 10, 0)

    const first = store.listArticles(owner, { limit: 6 })
    expect(first.items).toHaveLength(6)
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBeDefined()

    const second = store.listArticles(owner, {
      limit: 6,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    })
    expect(second.items).toHaveLength(4)
    expect(second.hasMore).toBe(false)
    expect(second.nextCursor).toBeUndefined()

    const ids = new Set([...first.items, ...second.items].map((a) => a.id))
    expect(ids.size).toBe(10)
    store.close()
  })

  it("isolates articles by owner subscription", () => {
    const store = openStore()
    const owner = "owner-a"
    const otherOwner = "owner-b"
    seedFeed(store, owner, "gamma", 5, 0)

    expect(store.listArticles(owner).items).toHaveLength(5)
    expect(store.listArticles(otherOwner).items).toEqual([])
    expect(store.listArticleFacets(otherOwner).states).toEqual({
      all: 0,
      unread: 0,
      saved: 0,
      later: 0,
    })
    store.close()
  })

  it("does not leak a disabled subscription's articles", () => {
    const store = openStore()
    const owner = "owner-a"
    const feed = seedFeed(store, owner, "delta", 3, 0)
    const subscription = store
      .listSubscriptions(owner)
      .find((s) => s.feedId === feed.id)!
    store.setSubscriptionEnabled(owner, subscription.id, false)

    expect(store.listArticles(owner).items).toEqual([])
    store.close()
  })

  it("filters by q across title, summary, and source name", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "epsilon", 10, 0)

    const bySummary = store.listArticles(owner, { q: "quarterly" })
    // index % 5 === 0 among 10 items -> indices 0 and 5
    expect(bySummary.items).toHaveLength(2)

    const bySource = store.listArticles(owner, { q: "epsilon" })
    expect(bySource.items).toHaveLength(10)

    const byTitle = store.listArticles(owner, { q: "article 3" })
    expect(byTitle.items.map((i) => i.title)).toEqual(["epsilon article 3"])

    const none = store.listArticles(owner, { q: "no-such-term" })
    expect(none.items).toEqual([])
    store.close()
  })

  it("filters by state (unread/saved) and by feedIds", () => {
    const store = openStore()
    const owner = "owner-a"
    const feedA = seedFeed(store, owner, "zeta", 4, 0)
    const feedB = seedFeed(store, owner, "eta", 3, 100)

    const zetaArticles = store.listArticles(owner, { feedIds: [feedA.id] })
    expect(zetaArticles.items).toHaveLength(4)
    expect(zetaArticles.items.every((a) => a.feedId === feedA.id)).toBe(true)

    const both = store.listArticles(owner, { feedIds: [feedA.id, feedB.id] })
    expect(both.items).toHaveLength(7)

    const target = store.listArticles(owner, { feedIds: [feedA.id] }).items[0]!
    store.setArticleState(owner, target.id, { read: true, saved: true })

    const unread = store.listArticles(owner, { state: "unread" })
    expect(unread.items.some((a) => a.id === target.id)).toBe(false)
    expect(unread.items).toHaveLength(6)

    const saved = store.listArticles(owner, { state: "saved" })
    expect(saved.items.map((a) => a.id)).toEqual([target.id])
    store.close()
  })

  it("orders by newest, oldest, and source and keeps pagination consistent per sort", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "atlas", 5, 0)
    seedFeed(store, owner, "bravo", 5, 0)

    const newest = store.listArticles(owner, { sort: "newest", limit: 100 })
    const publishedNewest = newest.items.map((a) => a.publishedAt)
    expect(publishedNewest).toEqual([...publishedNewest].sort().reverse())

    const oldest = store.listArticles(owner, { sort: "oldest", limit: 100 })
    const publishedOldest = oldest.items.map((a) => a.publishedAt)
    expect(publishedOldest).toEqual([...publishedOldest].sort())

    const bySource = store.listArticles(owner, { sort: "source", limit: 100 })
    const sources = bySource.items.map((a) => a.sourceName)
    expect(sources).toEqual([...sources].sort())

    // sort=source でのカーソル歩行でも重複・欠落がないこと
    const seen = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const page = store.listArticles(owner, {
        sort: "source",
        limit: 3,
        ...(cursor ? { cursor } : {}),
      })
      for (const item of page.items) seen.add(item.id)
      if (!page.hasMore) break
      cursor = page.nextCursor
    }
    expect(seen.size).toBe(10)
    store.close()
  })
})

describe("LocalStore.listArticleFacets", () => {
  it("reports state and per-feed counts scoped by q and feedIds", () => {
    const store = openStore()
    const owner = "owner-a"
    const feedA = seedFeed(store, owner, "north", 4, 0)
    const feedB = seedFeed(store, owner, "south", 2, 0)

    const target = store.listArticles(owner, { feedIds: [feedA.id] }).items[0]!
    store.setArticleState(owner, target.id, { saved: true })
    const readTarget = store.listArticles(owner, {
      feedIds: [feedB.id],
    }).items[0]!
    store.setArticleState(owner, readTarget.id, { read: true })

    const all = store.listArticleFacets(owner)
    expect(all.states).toEqual({ all: 6, unread: 5, saved: 1, later: 0 })
    expect(all.feeds).toEqual([
      { feedId: feedA.id, name: "north", count: 4 },
      { feedId: feedB.id, name: "south", count: 2 },
    ])

    const scoped = store.listArticleFacets(owner, { feedIds: [feedA.id] })
    expect(scoped.states.all).toBe(4)
    expect(scoped.feeds).toEqual([
      { feedId: feedA.id, name: "north", count: 4 },
    ])

    const searched = store.listArticleFacets(owner, { q: "quarterly" })
    // 各feedで index % 5 === 0 が1件ずつ一致する
    expect(searched.states.all).toBe(2)
    store.close()
  })
})

describe("LocalStore hidden/read-later article state", () => {
  it("excludes hidden articles from every state by default and restores them with includeHidden", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "hidden-feed", 3, 0)
    const target = store.listArticles(owner).items[0]!
    store.setArticleState(owner, target.id, { hidden: true })

    expect(store.listArticles(owner).items.map((a) => a.id)).not.toContain(
      target.id
    )
    expect(store.listArticles(owner, { state: "unread" }).items).toHaveLength(2)
    expect(
      store.listArticles(owner, { includeHidden: true }).items
    ).toHaveLength(3)
    expect(
      store.listArticles(owner, { includeHidden: true }).items.map((a) => a.id)
    ).toContain(target.id)

    const facets = store.listArticleFacets(owner)
    expect(facets.states.all).toBe(2)
    const facetsIncludingHidden = store.listArticleFacets(owner, {
      includeHidden: true,
    })
    expect(facetsIncludingHidden.states.all).toBe(3)
    store.close()
  })

  it("filters by state=later for articles marked read later", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "later-feed", 3, 0)
    const [first, second] = store.listArticles(owner).items
    store.setArticleState(owner, first!.id, { readLater: true })

    const later = store.listArticles(owner, { state: "later" })
    expect(later.items.map((a) => a.id)).toEqual([first!.id])
    expect(later.items[0]!.readLater).toBe(true)
    expect(second!.readLater).toBe(false)
    store.close()
  })

  it("preserves unspecified flags across partial setArticleState updates", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "partial-feed", 1, 0)
    const target = store.listArticles(owner).items[0]!

    const afterRead = store.setArticleState(owner, target.id, { read: true })!
    expect(afterRead).toMatchObject({
      read: true,
      saved: false,
      readLater: false,
      hidden: false,
    })

    const afterSaved = store.setArticleState(owner, target.id, {
      saved: true,
    })!
    expect(afterSaved).toMatchObject({
      read: true,
      saved: true,
      readLater: false,
      hidden: false,
    })

    const afterReadLater = store.setArticleState(owner, target.id, {
      readLater: true,
    })!
    expect(afterReadLater).toMatchObject({
      read: true,
      saved: true,
      readLater: true,
      hidden: false,
    })
    store.close()
  })

  it("sets hidden_at when hiding and clears it when unhiding", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "hidden-at-feed", 1, 0)
    const target = store.listArticles(owner).items[0]!

    const hidden = store.setArticleState(owner, target.id, {
      hidden: true,
    })!
    expect(hidden.hidden).toBe(true)
    expect(hidden.hiddenAt).toBeDefined()

    // hidden以外のフラグを変えてもhidden_atは保持される
    const stillHidden = store.setArticleState(owner, target.id, {
      saved: true,
    })!
    expect(stillHidden.hiddenAt).toBe(hidden.hiddenAt)

    const unhidden = store.setArticleState(owner, target.id, {
      hidden: false,
    })!
    expect(unhidden.hidden).toBe(false)
    expect(unhidden.hiddenAt).toBeUndefined()
    store.close()
  })
})

describe("LocalStore.bulkSetArticleState", () => {
  it("applies state only to articles matching the filter", () => {
    const store = openStore()
    const owner = "owner-a"
    const feedA = seedFeed(store, owner, "bulk-a", 3, 0)
    const feedB = seedFeed(store, owner, "bulk-b", 2, 100)

    const updated = store.bulkSetArticleState(
      owner,
      { feedIds: [feedA.id] },
      { read: true }
    )
    expect(updated).toBe(3)

    const feedAArticles = store.listArticles(owner, { feedIds: [feedA.id] })
    expect(feedAArticles.items.every((a) => a.read)).toBe(true)
    const feedBArticles = store.listArticles(owner, { feedIds: [feedB.id] })
    expect(feedBArticles.items.every((a) => a.read)).toBe(false)
    store.close()
  })

  it("marks all matching unread articles as read (select-all-read UI action)", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "bulk-mark-read", 4, 0)
    const [firstArticle] = store.listArticles(owner).items
    store.setArticleState(owner, firstArticle!.id, { read: true })

    const updated = store.bulkSetArticleState(
      owner,
      { state: "unread" },
      { read: true }
    )
    expect(updated).toBe(3)
    expect(store.listArticles(owner, { state: "unread" }).items).toHaveLength(0)
    store.close()
  })

  it("does not update another owner's articles", () => {
    const store = openStore()
    const owner = "owner-a"
    const otherOwner = "owner-b"
    seedFeed(store, owner, "bulk-owner-a", 2, 0)
    seedFeed(store, otherOwner, "bulk-owner-b", 2, 0)

    const updated = store.bulkSetArticleState(owner, {}, { saved: true })
    expect(updated).toBe(2)
    expect(store.listArticles(otherOwner).items.every((a) => !a.saved)).toBe(
      true
    )
    store.close()
  })

  it("respects includeHidden when bulk-applying state", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "bulk-hidden", 2, 0)
    const target = store.listArticles(owner).items[0]!
    store.setArticleState(owner, target.id, { hidden: true })

    const withoutHidden = store.bulkSetArticleState(owner, {}, { read: true })
    expect(withoutHidden).toBe(1)
    expect(store.getArticle(owner, target.id)!.read).toBe(false)

    const withHidden = store.bulkSetArticleState(
      owner,
      { includeHidden: true },
      { read: true }
    )
    expect(withHidden).toBe(2)
    expect(store.getArticle(owner, target.id)!.read).toBe(true)
    store.close()
  })
})

describe("LocalStore.listArticles publishedAfter/publishedBefore", () => {
  it("includes only articles within [publishedAfter, publishedBefore] (both boundaries inclusive)", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "range-feed", 5, 0) // hours 0..4 (UTC) on 2026-01-01

    const after = new Date(Date.UTC(2026, 0, 1, 1)).toISOString()
    const before = new Date(Date.UTC(2026, 0, 1, 3)).toISOString()
    const result = store.listArticles(owner, {
      publishedAfter: after,
      publishedBefore: before,
      sort: "oldest",
    })
    expect(result.items.map((a) => a.publishedAt)).toEqual([
      new Date(Date.UTC(2026, 0, 1, 1)).toISOString(),
      new Date(Date.UTC(2026, 0, 1, 2)).toISOString(),
      new Date(Date.UTC(2026, 0, 1, 3)).toISOString(),
    ])
    store.close()
  })

  it("excludes articles just outside the boundary", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "range-feed-2", 3, 0) // hours 0, 1, 2

    const result = store.listArticles(owner, {
      // 1ms after hour0、1ms before hour2 -> hour1のみヒット
      publishedAfter: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 1)).toISOString(),
      publishedBefore: new Date(
        Date.UTC(2026, 0, 1, 1, 59, 59, 999)
      ).toISOString(),
    })
    expect(result.items.map((a) => a.publishedAt)).toEqual([
      new Date(Date.UTC(2026, 0, 1, 1)).toISOString(),
    ])
    store.close()
  })

  it("falls back to discoveredAt for articles without publishedAt", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "no-pub",
      siteUrl: "https://no-pub.example.com",
      feedUrl: "https://no-pub.example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "no-pub-1",
        title: "No publishedAt",
        url: "https://no-pub.example.com/1",
      },
    ])
    const article = store.listArticles(owner).items[0]!
    expect(article.publishedAt).toBeUndefined()

    const discoveredAt = "2026-03-01T00:00:00.000Z"
    store.database
      .prepare("UPDATE feed_items SET discovered_at = ? WHERE id = ?")
      .run(discoveredAt, article.id)

    const hit = store.listArticles(owner, {
      publishedAfter: "2026-02-28T00:00:00.000Z",
      publishedBefore: "2026-03-02T00:00:00.000Z",
    })
    expect(hit.items.map((a) => a.id)).toEqual([article.id])

    const miss = store.listArticles(owner, {
      publishedAfter: "2026-03-02T00:00:00.000Z",
    })
    expect(miss.items).toEqual([])
    store.close()
  })

  it("keeps keyset pagination consistent (no duplicates/gaps) when combined with publishedAfter", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "range-paginate", 20, 0) // hours 0..19

    // hours 5..19 の15件のみが対象
    const after = new Date(Date.UTC(2026, 0, 1, 5)).toISOString()
    const seen = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    for (;;) {
      const page = store.listArticles(owner, {
        publishedAfter: after,
        limit: 4,
        ...(cursor ? { cursor } : {}),
      })
      pages += 1
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false)
        seen.add(item.id)
        expect(item.publishedAt! >= after).toBe(true)
      }
      if (!page.hasMore) {
        expect(page.nextCursor).toBeUndefined()
        break
      }
      cursor = page.nextCursor
      expect(pages).toBeLessThan(20)
    }
    expect(seen.size).toBe(15)
    store.close()
  })

  it("does not leak another owner's articles when filtering by publishedAfter", () => {
    const store = openStore()
    const owner = "owner-a"
    const otherOwner = "owner-b"
    seedFeed(store, owner, "range-iso-a", 3, 0)
    seedFeed(store, otherOwner, "range-iso-b", 3, 0)

    const after = new Date(Date.UTC(2026, 0, 1, 0)).toISOString()
    const result = store.listArticles(owner, { publishedAfter: after })
    expect(result.items.every((a) => a.sourceName === "range-iso-a")).toBe(true)
    store.close()
  })
})

describe("LocalStore.listArticles archiveStatus filter", () => {
  it("filters by a single and by multiple archive statuses", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "archive-status",
      siteUrl: "https://archive-status.example.com",
      feedUrl: "https://archive-status.example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "a",
        title: "A",
        url: "https://archive-status.example.com/a",
      },
      {
        externalId: "b",
        title: "B",
        url: "https://archive-status.example.com/b",
      },
      {
        externalId: "c",
        title: "C",
        url: "https://archive-status.example.com/c",
      },
    ])

    const succeeded = store.leaseArchiveCandidate()!
    store.completeArchive({
      articleId: succeeded.id,
      snapshotId: "00000000-0000-4000-8000-000000000040",
      sourceUrl: succeeded.url,
      title: succeeded.title,
      contentHash: "hash",
      rawKey: "raw",
      replayKey: "replay",
      markdownKey: "markdown",
      byteLength: 1,
      assets: [],
    })

    const failed = store.leaseArchiveCandidate()!
    store.failArchive(failed.id, "boom")

    const all = store.listArticles(owner, { limit: 100 }).items
    const pending = all.find((a) => a.archiveStatus === "pending")!

    expect(
      store
        .listArticles(owner, { archiveStatus: ["succeeded"] })
        .items.map((a) => a.id)
    ).toEqual([succeeded.id])

    expect(
      new Set(
        store
          .listArticles(owner, { archiveStatus: ["pending", "failed"] })
          .items.map((a) => a.id)
      )
    ).toEqual(new Set([pending.id, failed.id]))

    expect(all).toHaveLength(3)
    store.close()
  })

  it("does not leak another owner's articles when filtering by archiveStatus", () => {
    const store = openStore()
    const owner = "owner-a"
    const otherOwner = "owner-b"
    seedFeed(store, owner, "archive-status-iso-a", 3, 0)
    seedFeed(store, otherOwner, "archive-status-iso-b", 3, 0)

    const result = store.listArticles(owner, { archiveStatus: ["pending"] })
    expect(
      result.items.every((a) => a.sourceName === "archive-status-iso-a")
    ).toBe(true)
    store.close()
  })
})

describe("LocalStore.listArticleFacets publishedAfter/publishedBefore/archiveStatus", () => {
  it("matches the list count when scoped by publishedAfter", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "facet-range", 6, 0) // hours 0..5

    const after = new Date(Date.UTC(2026, 0, 1, 2)).toISOString()
    const list = store.listArticles(owner, {
      publishedAfter: after,
      limit: 100,
    })
    const facets = store.listArticleFacets(owner, { publishedAfter: after })
    expect(facets.states.all).toBe(list.items.length)
    expect(facets.states.all).toBe(4) // hours 2,3,4,5
    store.close()
  })

  it("matches the list count when scoped by archiveStatus", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "facet-archive-status",
      siteUrl: "https://facet-archive-status.example.com",
      feedUrl: "https://facet-archive-status.example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "x",
        title: "X",
        url: "https://facet-archive-status.example.com/x",
      },
      {
        externalId: "y",
        title: "Y",
        url: "https://facet-archive-status.example.com/y",
      },
    ])
    const succeeded = store.leaseArchiveCandidate()!
    store.completeArchive({
      articleId: succeeded.id,
      snapshotId: "00000000-0000-4000-8000-000000000041",
      sourceUrl: succeeded.url,
      title: succeeded.title,
      contentHash: "hash",
      rawKey: "raw",
      replayKey: "replay",
      markdownKey: "markdown",
      byteLength: 1,
      assets: [],
    })

    const list = store.listArticles(owner, { archiveStatus: ["succeeded"] })
    const facets = store.listArticleFacets(owner, {
      archiveStatus: ["succeeded"],
    })
    expect(facets.states.all).toBe(list.items.length)
    expect(facets.states.all).toBe(1)
    store.close()
  })
})

describe("LocalStore.bulkSetArticleState publishedAfter/publishedBefore/archiveStatus", () => {
  it("applies state only to articles within the published range", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "bulk-range", 5, 0) // hours 0..4

    const after = new Date(Date.UTC(2026, 0, 1, 2)).toISOString()
    const updated = store.bulkSetArticleState(
      owner,
      { publishedAfter: after },
      { read: true }
    )
    expect(updated).toBe(3) // hours 2,3,4

    for (const item of store.listArticles(owner, { limit: 100 }).items) {
      expect(item.read).toBe(item.publishedAt! >= after)
    }
    store.close()
  })

  it("applies state only to articles matching the archiveStatus filter", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "bulk-archive-status",
      siteUrl: "https://bulk-archive-status.example.com",
      feedUrl: "https://bulk-archive-status.example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "p",
        title: "P",
        url: "https://bulk-archive-status.example.com/p",
      },
      {
        externalId: "q",
        title: "Q",
        url: "https://bulk-archive-status.example.com/q",
      },
    ])
    const succeeded = store.leaseArchiveCandidate()!
    store.completeArchive({
      articleId: succeeded.id,
      snapshotId: "00000000-0000-4000-8000-000000000042",
      sourceUrl: succeeded.url,
      title: succeeded.title,
      contentHash: "hash",
      rawKey: "raw",
      replayKey: "replay",
      markdownKey: "markdown",
      byteLength: 1,
      assets: [],
    })

    const updated = store.bulkSetArticleState(
      owner,
      { archiveStatus: ["succeeded"] },
      { saved: true }
    )
    expect(updated).toBe(1)
    expect(store.getArticle(owner, succeeded.id)!.saved).toBe(true)
    const other = store
      .listArticles(owner, { limit: 100 })
      .items.find((a) => a.id !== succeeded.id)!
    expect(other.saved).toBe(false)
    store.close()
  })
})

describe("LocalStore usedInEpisode", () => {
  it("marks an article as usedInEpisode once its snapshot is referenced by an owned episode", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "episode-source-feed",
      siteUrl: "https://episode-source.example.com",
      feedUrl: "https://episode-source.example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "used",
        title: "Used article",
        url: "https://episode-source.example.com/used",
      },
    ])
    const candidate = store.leaseArchiveCandidate()!
    store.completeArchive({
      articleId: candidate.id,
      snapshotId: "00000000-0000-4000-8000-000000000030",
      sourceUrl: candidate.url,
      title: candidate.title,
      contentHash: "hash",
      rawKey: "raw",
      replayKey: "replay",
      markdownKey: "markdown",
      byteLength: 10,
      assets: [],
    })

    const beforeEpisode = store.getArticle(owner, candidate.id)!
    expect(beforeEpisode.usedInEpisode).toBe(false)

    store.database
      .prepare(
        `INSERT INTO episodes (id, owner_id, title, script, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        "00000000-0000-4000-8000-000000000031",
        owner,
        "Episode",
        "script",
        new Date().toISOString()
      )
    store.database
      .prepare(
        `INSERT INTO episode_sources
         (episode_id, position, url, title, published_at, snapshot_id, source_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "00000000-0000-4000-8000-000000000031",
        0,
        candidate.url,
        candidate.title,
        null,
        "00000000-0000-4000-8000-000000000030",
        "rss"
      )

    const afterEpisode = store.getArticle(owner, candidate.id)!
    expect(afterEpisode.usedInEpisode).toBe(true)

    const filtered = store.listArticles(owner, { usedInEpisode: true })
    expect(filtered.items.map((a) => a.id)).toEqual([candidate.id])
    const excluded = store.listArticles(owner, { usedInEpisode: false })
    expect(excluded.items).toEqual([])
    store.close()
  })
})

describe("LocalStore.listArticles full text search (FTS5 trigram)", () => {
  it("matches Japanese substrings that do not fall on word boundaries", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "jp-feed",
      siteUrl: "https://jp.example.com",
      feedUrl: "https://jp.example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "jp-1",
        title: "日本語全文検索を実用にする",
        url: "https://jp.example.com/1",
        publishedAt: new Date(Date.UTC(2026, 0, 1, 0)).toISOString(),
        summary: "検索精度の話",
      },
      {
        externalId: "jp-2",
        title: "無関係な記事",
        url: "https://jp.example.com/2",
        publishedAt: new Date(Date.UTC(2026, 0, 1, 1)).toISOString(),
        summary: "天気予報",
      },
    ])

    const hit = store.listArticles(owner, { q: "全文検索" })
    expect(hit.items.map((a) => a.title)).toEqual([
      "日本語全文検索を実用にする",
    ])
    store.close()
  })

  it("matches English substrings across summary, title, and source name", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "fts-en", 10, 0)

    const bySummary = store.listArticles(owner, { q: "quarterly" })
    expect(bySummary.items).toHaveLength(2)

    const bySource = store.listArticles(owner, { q: "fts-en" })
    expect(bySource.items).toHaveLength(10)

    const byTitle = store.listArticles(owner, { q: "article 3" })
    expect(byTitle.items.map((i) => i.title)).toEqual(["fts-en article 3"])

    const none = store.listArticles(owner, { q: "no-such-term" })
    expect(none.items).toEqual([])
    store.close()
  })

  it("falls back to LIKE for 1-2 character queries that trigram cannot index", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "short-feed",
      siteUrl: "https://short.example.com",
      feedUrl: "https://short.example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "short-1",
        title: "AI速報",
        url: "https://short.example.com/1",
        publishedAt: new Date(Date.UTC(2026, 0, 1, 0)).toISOString(),
        summary: "no match here",
      },
      {
        externalId: "short-2",
        title: "unrelated",
        url: "https://short.example.com/2",
        publishedAt: new Date(Date.UTC(2026, 0, 1, 1)).toISOString(),
        summary: "still nothing",
      },
    ])

    // trigramは3文字未満のクエリに一切マッチしないため、LIKEフォールバックが
    // 効いていなければここは無言で0件になってしまう。
    const oneChar = store.listArticles(owner, { q: "速" })
    expect(oneChar.items.map((a) => a.title)).toEqual(["AI速報"])

    const twoChar = store.listArticles(owner, { q: "AI" })
    expect(twoChar.items.map((a) => a.title)).toEqual(["AI速報"])
    store.close()
  })

  it("treats FTS special characters as a literal phrase instead of query syntax", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "syntax-feed",
      siteUrl: "https://syntax.example.com",
      feedUrl: "https://syntax.example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "syntax-1",
        title: 'literal "quote" OR * NEAR test',
        url: "https://syntax.example.com/1",
        publishedAt: new Date(Date.UTC(2026, 0, 1, 0)).toISOString(),
      },
      {
        externalId: "syntax-2",
        title: "unrelated article",
        url: "https://syntax.example.com/2",
        publishedAt: new Date(Date.UTC(2026, 0, 1, 1)).toISOString(),
      },
    ])

    // 特殊構文を含むクエリでも例外にならず、リテラル部分一致として振る舞うこと。
    expect(() =>
      store.listArticles(owner, { q: '"quote" OR * NEAR' })
    ).not.toThrow()
    const result = store.listArticles(owner, { q: '"quote" OR * NEAR' })
    expect(result.items.map((a) => a.title)).toEqual([
      'literal "quote" OR * NEAR test',
    ])
    store.close()
  })

  it("matches on body text that only exists in the FTS index (not in feed_items columns)", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "body-feed",
      siteUrl: "https://body.example.com",
      feedUrl: "https://body.example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "body-1",
        title: "generic headline",
        url: "https://body.example.com/1",
        publishedAt: new Date(Date.UTC(2026, 0, 1, 0)).toISOString(),
      },
      {
        externalId: "body-2",
        title: "another generic headline",
        url: "https://body.example.com/2",
        publishedAt: new Date(Date.UTC(2026, 0, 1, 1)).toISOString(),
      },
    ])
    const [withBody, withoutBody] = store.listArticles(owner, {
      sort: "oldest",
    }).items
    store.setArticleSearchBody(
      withBody!.id,
      "この記事は蒸気タービンの効率について詳しく解説する。"
    )
    store.setArticleSearchBody(withoutBody!.id, "全く別の話題について書く。")

    const hit = store.listArticles(owner, { q: "蒸気タービン" })
    expect(hit.items.map((a) => a.id)).toEqual([withBody!.id])
    store.close()
  })

  it("keeps search + keyset pagination free of duplicates and gaps", () => {
    const store = openStore()
    const owner = "owner-a"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "paginated-feed",
      siteUrl: "https://paginated.example.com",
      feedUrl: "https://paginated.example.com/feed.xml",
    })
    store.upsertFeedItems(
      feed.id,
      Array.from({ length: 23 }, (_, index) => ({
        externalId: `paginated-${index}`,
        title: index % 2 === 0 ? `matching item ${index}` : `skip ${index}`,
        url: `https://paginated.example.com/${index}`,
        publishedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      }))
    )

    const seen = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    for (;;) {
      const page = store.listArticles(owner, {
        q: "matching",
        limit: 5,
        ...(cursor ? { cursor } : {}),
      })
      pages += 1
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false)
        seen.add(item.id)
      }
      if (!page.hasMore) break
      cursor = page.nextCursor
      expect(pages).toBeLessThan(20)
    }
    expect(seen.size).toBe(12)
    store.close()
  })

  it("isolates FTS search results by owner subscription", () => {
    const store = openStore()
    const owner = "owner-a"
    const otherOwner = "owner-b"
    seedFeed(store, owner, "isolated-fts", 3, 0)

    expect(store.listArticles(owner, { q: "isolated-fts" }).items).toHaveLength(
      3
    )
    expect(store.listArticles(otherOwner, { q: "isolated-fts" }).items).toEqual(
      []
    )
    store.close()
  })

  it("reports facets counts that match the FTS search predicate", () => {
    const store = openStore()
    const owner = "owner-a"
    seedFeed(store, owner, "facets-fts", 10, 0)

    const searchResult = store.listArticles(owner, {
      q: "quarterly",
      limit: 100,
    })
    const facets = store.listArticleFacets(owner, { q: "quarterly" })
    expect(facets.states.all).toBe(searchResult.items.length)
    expect(facets.states.all).toBe(2)
    store.close()
  })
})
