import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"

describe("POST /v1/feeds", () => {
  it("discovers and subscribes to an arbitrary RSS URL", async () => {
    const response = await createApp({
      resolveOwner: async () => "owner-1",
      discoverFeed: async (_ownerId, feedUrl) => ({
        feed: {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Example",
          siteUrl: "https://example.com",
          feedUrl,
        },
        subscription: {
          id: "00000000-0000-4000-8000-000000000002",
          feedId: "00000000-0000-4000-8000-000000000001",
          enabled: true,
          createdAt: "2026-08-10T00:00:00.000Z",
        },
      }),
    }).request("/v1/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedUrl: "https://example.com/feed.xml" }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      feed: { name: "Example" },
      subscription: { enabled: true },
    })
  })
})
