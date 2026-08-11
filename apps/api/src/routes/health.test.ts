import { describe, expect, it } from "vitest"

import { createApp } from "../app.js"

describe("API foundation", () => {
  it("serves a credential-free health check", async () => {
    const response = await createApp().request("/health")
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "ok" })
  })
})
