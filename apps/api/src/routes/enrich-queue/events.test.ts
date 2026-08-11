import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"
import {
  seedArchivedArticle,
  useTemporaryStore,
} from "../../testing/fixtures.js"

const openStore = useTemporaryStore("news-podcast-api-ai-enrich-")

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
