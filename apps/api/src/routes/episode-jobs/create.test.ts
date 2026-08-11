import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"

describe("POST /v1/episode-jobs", () => {
  it("returns 202 and resource headers from the episode job seam", async () => {
    const response = await createApp({
      resolveOwner: async () => "00000000-0000-4000-8000-000000000100",
      createEpisodeJob: async () => ({
        id: "00000000-0000-4000-8000-000000000001",
        status: "queued",
        createdAt: "2026-08-09T00:00:00.000Z",
        attempt: 0,
        maxAttempts: 4,
      }),
    }).request("/v1/episode-jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "test",
      },
      body: JSON.stringify({ trigger: "manual" }),
    })
    expect(response.status).toBe(202)
    expect(response.headers.get("Location")).toBe(
      "/v1/episode-jobs/00000000-0000-4000-8000-000000000001"
    )
    expect(response.headers.get("Idempotency-Key")).toBe("test")
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
    })
  })
})
