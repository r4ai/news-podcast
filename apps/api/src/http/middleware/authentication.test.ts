import { describe, expect, it } from "vitest"

import { createApp } from "../../app.js"

describe("authenticationMiddleware", () => {
  it("returns a contract-shaped 503 when protected-route authentication fails", async () => {
    const response = await createApp({
      resolveOwner: () => Promise.reject(new Error("session store down")),
    }).request("/v1/feeds")

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      status: 503,
      code: "service-unavailable",
    })
  })
})
