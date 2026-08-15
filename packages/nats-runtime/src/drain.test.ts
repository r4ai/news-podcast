import { describe, expect, it, vi } from "vitest"

import { drainNatsConnection } from "./drain.js"

describe("bounded NATS drain", () => {
  it("keeps a successful graceful drain", async () => {
    const drain = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)

    await drainNatsConnection({ drain, close }, 10)

    expect(drain).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
  })

  it.each([
    ["timeout", () => new Promise<void>(() => undefined)],
    ["rejection", () => Promise.reject(new Error("transport closed"))],
  ])("forces close after drain %s", async (_case, drain) => {
    const close = vi.fn(async () => undefined)

    await drainNatsConnection({ drain, close }, 1)

    expect(close).toHaveBeenCalledOnce()
  })
})
