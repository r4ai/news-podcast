import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"
import { useTemporaryStore } from "../../testing/fixtures.js"

const openStore = useTemporaryStore("news-podcast-api-ai-enrich-")

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
