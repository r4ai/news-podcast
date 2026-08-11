import { describe, expect, it } from "vitest"
import { computeProfileHash } from "@news-podcast/adapters/ai-enrich/shared"

import { createApp } from "../../app.js"
import {
  seedArchivedArticle,
  useTemporaryStore,
} from "../../testing/fixtures.js"

const openStore = useTemporaryStore("news-podcast-api-ai-enrich-")

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
