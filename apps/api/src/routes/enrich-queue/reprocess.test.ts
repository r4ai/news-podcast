import { describe, expect, it } from "vitest"
import { computeProfileHash } from "@news-podcast/adapters/ai-enrich/shared"

import { createApp } from "../../app.js"
import {
  seedArchivedArticle,
  useTemporaryStore,
} from "../../testing/fixtures.js"

const openStore = useTemporaryStore("news-podcast-api-ai-enrich-")

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
