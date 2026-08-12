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

  it("keeps showing the latest relevance score even when the profile_hash becomes stale", () => {
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

    // プロフィール変更で自動再処理しなくなったため、旧プロフィールのスコアを表示し続ける。
    const article = store.getArticle(owner, id)
    expect(article?.relevanceScore).toBe(99)
    expect(article?.relevanceReason).toBe("古いプロフィールでのスコア")
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

describe("LocalStore enrich_queue", () => {
  const NOW = new Date("2026-08-11T00:00:00.000Z")

  it("reconcile enqueues never-processed articles as new with priority 0", () => {
    const store = openStore()
    const owner = "owner-reconcile"
    seedArchivedArticle(store, owner, "fresh", "2026-01-02T00:00:00.000Z")
    store.reconcileEnrichQueue(NOW)

    const status = store.listEnrichQueueStatus(owner, 200)
    expect(status.pending.count).toBe(1)
    expect(status.pending.items[0]?.reason).toBe("new")
    expect(status.pending.items[0]?.priority).toBe(0)
    expect(status.processing).toHaveLength(0)
  })

  it("reconcile does not re-enqueue articles processed under any profile_hash", () => {
    const store = openStore()
    const owner = "owner-processed"
    const id = seedArchivedArticle(
      store,
      owner,
      "done",
      "2026-01-01T00:00:00.000Z"
    )
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: id,
      profileHash: "any-hash",
      model: "m",
      score: 50,
      reason: "r",
      tokensIn: 0,
      tokensOut: 0,
    })

    store.reconcileEnrichQueue(NOW)
    expect(store.countEnrichPending(owner)).toBe(0)
  })

  it("interest profile change does NOT re-enqueue already-processed articles", () => {
    const store = openStore()
    const owner = "owner-profile-change"
    const id = seedArchivedArticle(
      store,
      owner,
      "kept",
      "2026-01-01T00:00:00.000Z"
    )
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: id,
      profileHash: computeProfileHash("old", ""),
      model: "m",
      score: 70,
      reason: "r",
      tokensIn: 0,
      tokensOut: 0,
    })

    store.setInterestProfile(owner, { include: "new", exclude: "" })
    store.reconcileEnrichQueue(NOW)
    expect(store.countEnrichPending(owner)).toBe(0)
  })

  it("reconcile reclaims expired processing leases back to queued", () => {
    const store = openStore()
    const owner = "owner-lease"
    seedArchivedArticle(store, owner, "expired", "2026-01-01T00:00:00.000Z")
    store.reconcileEnrichQueue(NOW)
    const claimed = store.leaseEnrichBatch(owner, 8, NOW)
    expect(claimed).toHaveLength(1)
    expect(store.listEnrichQueueStatus(owner, 200).processing).toHaveLength(1)

    store.reconcileEnrichQueue(new Date("2026-08-11T00:20:00.000Z"))
    const status = store.listEnrichQueueStatus(owner, 200)
    expect(status.processing).toHaveLength(0)
    expect(status.pending.count).toBe(1)
  })

  it("claims new articles before explicit reprocess and newest published first", () => {
    const store = openStore()
    const owner = "owner-priority"
    const aNever = seedArchivedArticle(
      store,
      owner,
      "a-never",
      "2026-01-02T00:00:00.000Z"
    )
    const bProcessed = seedArchivedArticle(
      store,
      owner,
      "b-processed",
      "2026-01-01T00:00:00.000Z"
    )
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: bProcessed,
      profileHash: computeProfileHash("", ""),
      model: "m",
      score: 10,
      reason: "r",
      tokensIn: 0,
      tokensOut: 0,
    })
    store.enqueueReprocess(owner, NOW)
    store.reconcileEnrichQueue(NOW)

    const claimed = store.leaseEnrichBatch(owner, 8, NOW)
    expect(claimed.map((item) => item.feedItemId)).toEqual([aNever, bProcessed])
  })

  it("marks succeeded and failed items with attempt/error and stops after the attempt cap", () => {
    const store = openStore()
    const owner = "owner-complete"
    seedArchivedArticle(store, owner, "ok", "2026-01-01T00:00:00.000Z")
    seedArchivedArticle(store, owner, "ng", "2026-01-02T00:00:00.000Z")
    store.reconcileEnrichQueue(NOW)
    const claimed = store.leaseEnrichBatch(owner, 8, NOW)
    expect(claimed).toHaveLength(2)
    store.completeEnrichBatch(
      owner,
      {
        succeeded: [claimed[0]!.feedItemId],
        failed: [{ feedItemId: claimed[1]!.feedItemId, error: "boom" }],
      },
      NOW
    )

    const status = store.listEnrichQueueStatus(owner, 200)
    // 1回失敗（attempt=1<上限）は再試行対象として「待ち」に残る。
    expect(status.pending.count).toBe(1)
    expect(status.pending.items[0]?.feedItemId).toBe(claimed[1]?.feedItemId)
    expect(status.pending.items[0]?.attempt).toBe(1)
    const ng = status.recent.find(
      (item) => item.feedItemId === claimed[1]?.feedItemId
    )
    expect(ng?.status).toBe("failed")
    expect(ng?.attempt).toBe(1)
    expect(ng?.error).toBe("boom")
  })

  it("treats an article that failed MAX_ENRICH_ATTEMPTS times as terminal", () => {
    const store = openStore()
    const owner = "owner-cap"
    seedArchivedArticle(store, owner, "cap", "2026-01-01T00:00:00.000Z")
    store.reconcileEnrichQueue(NOW)
    for (let index = 0; index < 4; index += 1) {
      const batch = store.leaseEnrichBatch(owner, 8, NOW)
      expect(batch).toHaveLength(1)
      store.completeEnrichBatch(
        owner,
        {
          succeeded: [],
          failed: [{ feedItemId: batch[0]!.feedItemId, error: `e${index}` }],
        },
        NOW
      )
    }

    expect(store.leaseEnrichBatch(owner, 8, NOW)).toHaveLength(0)
    const status = store.listEnrichQueueStatus(owner, 200)
    expect(status.failed.count).toBe(1)
    expect(status.pending.count).toBe(0)
    expect(store.countEnrichPending(owner)).toBe(0)
  })

  it("terminalizes a non-retryable enrichment failure immediately", () => {
    const store = openStore()
    const owner = "owner-permanent-failure"
    seedArchivedArticle(store, owner, "permanent", "2026-01-01T00:00:00.000Z")
    store.reconcileEnrichQueue(NOW)
    const [claimed] = store.leaseEnrichBatch(owner, 8, NOW)

    store.completeEnrichBatch(
      owner,
      {
        succeeded: [],
        failed: [
          {
            feedItemId: claimed!.feedItemId,
            error: "invalid request",
            retryable: false,
          },
        ],
      },
      NOW
    )

    expect(store.countEnrichPending(owner)).toBe(0)
    expect(store.listEnrichQueueStatus(owner, 200).failed.items[0]).toMatchObject(
      { feedItemId: claimed!.feedItemId, attempt: 4, error: "invalid request" }
    )
  })

  it("enqueueReprocess queues only processed articles at priority 100", () => {
    const store = openStore()
    const owner = "owner-reprocess"
    const done = seedArchivedArticle(
      store,
      owner,
      "done",
      "2026-01-01T00:00:00.000Z"
    )
    seedArchivedArticle(store, owner, "fresh", "2026-01-02T00:00:00.000Z")
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: done,
      profileHash: computeProfileHash("", ""),
      model: "m",
      score: 1,
      reason: "r",
      tokensIn: 0,
      tokensOut: 0,
    })
    store.reconcileEnrichQueue(NOW)
    const enqueued = store.enqueueReprocess(owner, NOW)
    expect(enqueued).toBe(1)

    const status = store.listEnrichQueueStatus(owner, 200)
    const item = status.pending.items.find((row) => row.feedItemId === done)
    expect(item?.priority).toBe(100)
    expect(item?.reason).toBe("reprocess")
  })

  it("enqueueReprocess recovers an article after terminal relevance failure", () => {
    const store = openStore()
    const owner = "owner-reprocess-failed"
    const failed = seedArchivedArticle(
      store,
      owner,
      "failed",
      "2026-01-01T00:00:00.000Z"
    )
    store.saveArticleRelevanceFailure({
      ownerId: owner,
      feedItemId: failed,
      profileHash: computeProfileHash("", ""),
      model: "m",
      error: "unsupported parameter",
    })
    store.reconcileEnrichQueue(NOW)
    for (let index = 0; index < 4; index += 1) {
      const batch = store.leaseEnrichBatch(owner, 8, NOW)
      store.completeEnrichBatch(
        owner,
        {
          succeeded: [],
          failed: [{ feedItemId: batch[0]!.feedItemId, error: "boom" }],
        },
        NOW
      )
    }

    expect(store.listEnrichQueueStatus(owner, 200).failed.count).toBe(1)
    expect(store.enqueueReprocess(owner, NOW)).toBe(1)

    const pending = store.listEnrichQueueStatus(owner, 200).pending.items[0]
    expect(pending?.feedItemId).toBe(failed)
    expect(pending?.status).toBe("queued")
    expect(pending?.attempt).toBe(0)
    expect(pending?.error).toBeUndefined()
  })

  it("listEnrichQueueStatus reports daily usage and reprocessable count", () => {
    const store = openStore()
    const owner = "owner-status"
    seedArchivedArticle(store, owner, "done", "2026-01-01T00:00:00.000Z")
    const id = seedArchivedArticle(
      store,
      owner,
      "fresh",
      "2026-01-02T00:00:00.000Z"
    )
    store.saveArticleRelevance({
      ownerId: owner,
      feedItemId: id,
      profileHash: computeProfileHash("", ""),
      model: "m",
      score: 5,
      reason: "r",
      tokensIn: 0,
      tokensOut: 0,
    })
    store.incrementEnrichProcessed(new Date().toISOString().slice(0, 10), 3)
    store.reconcileEnrichQueue(NOW)

    const status = store.listEnrichQueueStatus(owner, 200)
    expect(status.daily).toEqual({ used: 3, limit: 200 })
    expect(status.reprocessable.count).toBe(1)
    expect(status.pending.count).toBe(1)
  })
})
