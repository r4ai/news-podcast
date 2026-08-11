import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"

describe("GET /api/auth/state", () => {
  it("reports unauthenticated state without caching it", async () => {
    const response = await createApp({
      authHandler: () => new Response(null, { status: 404 }),
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
})
