import { describe, expect, it } from "vitest"

import { createApp } from "./app.js"

describe("API foundation", () => {
  it("serves a credential-free health check", async () => {
    const response = await createApp().request("/health")
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "ok" })
  })

  it("reports unauthenticated state without caching it", async () => {
    const response = await createApp({
      loginMethods: { development: true, google: false },
      resolveOwner: async () => null,
    }).request("/api/auth/state")

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      loginMethods: { development: true, google: false },
    })
  })

  it("reports authenticated state for either session implementation", async () => {
    const response = await createApp({
      loginMethods: { development: false, google: true },
      resolveOwner: async () => "00000000-0000-4000-8000-000000000100",
    }).request("/api/auth/state")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      loginMethods: { development: false, google: true },
    })
  })

  it("keeps authentication infrastructure failures distinct", async () => {
    const response = await createApp({
      resolveOwner: () => Promise.reject(new Error("session store down")),
    }).request("/api/auth/state")

    expect(response.status).toBe(503)
  })

  it("returns 202 and resource headers from the episode job seam", async () => {
    const response = await createApp({
      resolveOwner: async () => "00000000-0000-4000-8000-000000000100",
      createEpisodeJob: async () => ({
        id: "00000000-0000-4000-8000-000000000001",
        status: "queued",
        createdAt: "2026-08-09T00:00:00.000Z",
        attempt: 0,
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
