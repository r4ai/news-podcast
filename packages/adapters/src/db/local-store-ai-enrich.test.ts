import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { computeProfileHash } from "../ai-enrich/shared.js"
import { LocalStore } from "./local-store.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function openStore(): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), "news-podcast-ai-enrich-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

function seedArchivedArticle(
  store: LocalStore,
  ownerId: string,
  externalId: string,
  publishedAt: string
): string {
  const { feed } = store.registerFeed({
    ownerId,
    name: `feed-${externalId}`,
    siteUrl: `https://${externalId}.example.com`,
    feedUrl: `https://${externalId}.example.com/feed.xml`,
  })
  store.upsertFeedItems(feed.id, [
    {
      externalId,
      title: `title-${externalId}`,
      url: `https://${externalId}.example.com/article`,
      publishedAt,
    },
  ])
  const candidate = store.leaseArchiveCandidate()!
  store.completeArchive({
    articleId: candidate.id,
    snapshotId: `${externalId}-snapshot`,
    sourceUrl: candidate.url,
    title: candidate.title,
    contentHash: `${externalId}-hash`,
    rawKey: `${externalId}/raw.html`,
    replayKey: `${externalId}/replay.html`,
    markdownKey: `${externalId}/markdown.md`,
    byteLength: 100,
    assets: [],
  })
  return candidate.id
}

describe("LocalStore interest profile", () => {
  it("round-trips include/exclude and keeps them isolated per owner", () => {
    const store = openStore()
    store.setInterestProfile("owner-a", { include: "AI", exclude: "野球" })
    store.setInterestProfile("owner-b", { include: "料理", exclude: "" })

    expect(store.getInterestProfile("owner-a")).toEqual({
      include: "AI",
      exclude: "野球",
    })
    expect(store.getInterestProfile("owner-b")).toEqual({
      include: "料理",
      exclude: "",
    })
  })

  it("defaults to empty include/exclude for an owner that never set one", () => {
    const store = openStore()
    expect(store.getInterestProfile("owner-unset")).toEqual({
      include: "",
      exclude: "",
    })
  })
})

describe("LocalStore.listArticles sort=relevance", () => {
  it("orders scored articles by score desc and pushes unscored articles to the tail", () => {
    const store = openStore()
    const owner = "owner-relevance"
    const idLow = seedArchivedArticle(
      store,
      owner,
      "low",
      "2026-01-01T00:00:00.000Z"
    )
    const idHigh = seedArchivedArticle(
      store,
      owner,
      "high",
      "2026-01-02T00:00:00.000Z"
    )
    const idUnscored = seedArchivedArticle(
      store,
      owner,
      "unscored",
      "2026-01-03T00:00:00.000Z"
    )

    const profileHash = computeProfileHash(
      store.getInterestProfile(owner).include,
      store.getInterestProfile(owner).exclude
    )
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: idLow,
      profileHash,
      model: "test-model",
      score: 20,
      reason: "低め",
      tokensIn: 10,
      tokensOut: 5,
    })
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: idHigh,
      profileHash,
      model: "test-model",
      score: 95,
      reason: "高め",
      tokensIn: 10,
      tokensOut: 5,
    })

    const result = store.listArticles(owner, { sort: "relevance" })
    expect(result.items.map((item) => item.id)).toEqual([
      idHigh,
      idLow,
      idUnscored,
    ])
    expect(result.items[0]?.relevanceScore).toBe(95)
    expect(result.items[0]?.relevanceReason).toBe("高め")
    expect(result.items[2]?.relevanceScore).toBeUndefined()
  })

  it("treats a stale profile_hash (interest profile changed) as unscored for ordering and display", () => {
    const store = openStore()
    const owner = "owner-stale"
    const id = seedArchivedArticle(
      store,
      owner,
      "stale",
      "2026-01-01T00:00:00.000Z"
    )
    const staleHash = computeProfileHash("old-include", "")
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: id,
      profileHash: staleHash,
      model: "test-model",
      score: 99,
      reason: "古いプロフィールでのスコア",
      tokensIn: 1,
      tokensOut: 1,
    })

    const article = store.getArticle(owner, id)
    expect(article?.relevanceScore).toBeUndefined()
  })

  it("supports keyset pagination under sort=relevance without duplicates or gaps", () => {
    const store = openStore()
    const owner = "owner-relevance-paginate"
    const profileHash = computeProfileHash("", "")
    const ids: string[] = []
    for (let index = 0; index < 12; index += 1) {
      const id = seedArchivedArticle(
        store,
        owner,
        `page-${index}`,
        new Date(Date.UTC(2026, 0, 1, index)).toISOString()
      )
      ids.push(id)
      store.saveArticleRelevance({
        ownerId: owner,
        feedItemId: id,
        profileHash,
        model: "test-model",
        score: index * 5,
        reason: "r",
        tokensIn: 0,
        tokensOut: 0,
      })
    }

    const seen = new Set<string>()
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const page = store.listArticles(owner, {
        sort: "relevance",
        limit: 5,
        ...(cursor ? { cursor } : {}),
      })
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false)
        seen.add(item.id)
      }
      if (!page.hasMore) break
      cursor = page.nextCursor
    }
    expect(seen.size).toBe(12)
  })
})

describe("LocalStore.listArticles minScore", () => {
  it("excludes unscored articles and articles below the threshold", () => {
    const store = openStore()
    const owner = "owner-minscore"
    const profileHash = computeProfileHash("", "")
    const idAbove = seedArchivedArticle(
      store,
      owner,
      "above",
      "2026-01-01T00:00:00.000Z"
    )
    const idBelow = seedArchivedArticle(
      store,
      owner,
      "below",
      "2026-01-02T00:00:00.000Z"
    )
    seedArchivedArticle(store, owner, "unscored", "2026-01-03T00:00:00.000Z")
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: idAbove,
      profileHash,
      model: "m",
      score: 80,
      reason: "r",
      tokensIn: 0,
      tokensOut: 0,
    })
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: idBelow,
      profileHash,
      model: "m",
      score: 30,
      reason: "r",
      tokensIn: 0,
      tokensOut: 0,
    })

    const result = store.listArticles(owner, { minScore: 50 })
    expect(result.items.map((item) => item.id)).toEqual([idAbove])
  })
})

describe("LocalStore article relevance owner isolation", () => {
  it("never leaks one owner's relevance score onto another owner's view of a different article", () => {
    const store = openStore()
    const idX = seedArchivedArticle(
      store,
      "owner-x",
      "x-1",
      "2026-01-01T00:00:00.000Z"
    )
    const idY = seedArchivedArticle(
      store,
      "owner-y",
      "y-1",
      "2026-01-01T00:00:00.000Z"
    )
    const hashX = computeProfileHash(
      store.getInterestProfile("owner-x").include,
      store.getInterestProfile("owner-x").exclude
    )
    store.saveArticleRelevance({
      ownerId: "owner-x",
      feedItemId: idX,
      profileHash: hashX,
      model: "m",
      score: 77,
      reason: "r",
      tokensIn: 0,
      tokensOut: 0,
    })

    expect(store.getArticle("owner-x", idX)?.relevanceScore).toBe(77)
    // owner-yは自分の記事しか見えず（購読関係が別）、owner-xのスコアも見えない。
    expect(store.getArticle("owner-y", idY)?.relevanceScore).toBeUndefined()
    expect(store.getArticle("owner-y", idX)).toBeUndefined()
  })
})
