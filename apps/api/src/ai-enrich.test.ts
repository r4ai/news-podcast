import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { LocalStore } from "@news-podcast/adapters/db/local"
import { computeProfileHash } from "@news-podcast/adapters/ai-enrich/shared"

import { createApp } from "./app.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function openStore(): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), "news-podcast-api-ai-enrich-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

function seedArchivedArticle(
  store: LocalStore,
  ownerId: string,
  externalId: string
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

describe("GET /v1/me/enrich/queue", () => {
  it("returns the queue status with the daily budget and reprocessable count", async () => {
    const store = openStore()
    const owner = "owner-queue-status"
    seedArchivedArticle(store, owner, "done")
    const id = seedArchivedArticle(store, owner, "fresh")
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
    store.reconcileEnrichQueue(new Date("2026-08-11T00:00:00.000Z"))
    const app = createApp({
      store,
      resolveOwner: async () => owner,
      enrichDailyLimit: 150,
    })

    const response = await app.request("/v1/me/enrich/queue")
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      daily: { used: number; limit: number }
      reprocessable: { count: number }
      pending: { count: number }
    }
    expect(body.daily).toEqual({ used: 0, limit: 150 })
    expect(body.reprocessable.count).toBe(1)
    expect(body.pending.count).toBe(1)
    store.close()
  })

  it("returns 503 without a store", async () => {
    const app = createApp({ resolveOwner: async () => "owner" })
    const response = await app.request("/v1/me/enrich/queue")
    expect(response.status).toBe(503)
  })
})

describe("POST /v1/me/enrich/reprocess", () => {
  it("enqueues already-processed articles and returns the count", async () => {
    const store = openStore()
    const owner = "owner-reprocess-api"
    const done = seedArchivedArticle(store, owner, "done")
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
    const app = createApp({ store, resolveOwner: async () => owner })

    const response = await app.request("/v1/me/enrich/reprocess", {
      method: "POST",
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { enqueued: number }
    expect(body.enqueued).toBe(1)
    store.close()
  })

  it("returns 503 without a store", async () => {
    const app = createApp({ resolveOwner: async () => "owner" })
    const response = await app.request("/v1/me/enrich/reprocess", {
      method: "POST",
    })
    expect(response.status).toBe(503)
  })
})

describe("GET /v1/me/enrich/queue/events", () => {
  it("streams a queue status snapshot over SSE", async () => {
    const store = openStore()
    const owner = "owner-queue-events"
    seedArchivedArticle(store, owner, "pending")
    store.reconcileEnrichQueue(new Date("2026-08-11T00:00:00.000Z"))
    const app = createApp({ store, resolveOwner: async () => owner })

    const controller = new AbortController()
    const response = await app.request("/v1/me/enrich/queue/events", {
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/event-stream")

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ""
    for (let index = 0; index < 20; index += 1) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
      if (text.includes("snapshot")) break
    }
    controller.abort()
    expect(text).toContain('"type":"snapshot"')
    expect(text).toContain('"pending"')
    store.close()
  })
})

describe("GET/PATCH /v1/me/settings interest profile", () => {
  it("round-trips the interest profile alongside the generation schedule", async () => {
    const store = openStore()
    const owner = "owner-settings"
    const app = createApp({ store, resolveOwner: async () => owner })

    const patched = await app.request("/v1/me/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interestProfile: { include: "AI 半導体", exclude: "野球" },
      }),
    })
    expect(patched.status).toBe(200)
    const body = (await patched.json()) as {
      interestProfile: { include: string; exclude: string }
      generationSchedule: unknown
    }
    expect(body.interestProfile).toEqual({
      include: "AI 半導体",
      exclude: "野球",
    })
    expect(body.generationSchedule).toBeDefined()

    const fetched = await app.request("/v1/me/settings")
    const fetchedBody = (await fetched.json()) as {
      interestProfile: { include: string; exclude: string }
    }
    expect(fetchedBody.interestProfile).toEqual({
      include: "AI 半導体",
      exclude: "野球",
    })
    store.close()
  })
})

describe("GET /v1/me/articles sort=relevance and minScore", () => {
  it("places unscored articles after scored ones and honors minScore", async () => {
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
    const profileHash = computeProfileHash("", "")
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
