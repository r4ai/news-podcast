import { describe, expect, it, vi } from "vitest"

import {
  computeProfileHash,
  fetchWithRetry,
  parseRetryAfterMs,
} from "./shared.js"

describe("computeProfileHash", () => {
  it("is deterministic for the same include/exclude", () => {
    expect(computeProfileHash("AI", "スポーツ")).toBe(
      computeProfileHash("AI", "スポーツ")
    )
  })

  it("changes when either include or exclude changes", () => {
    const base = computeProfileHash("AI", "スポーツ")
    expect(computeProfileHash("AI 半導体", "スポーツ")).not.toBe(base)
    expect(computeProfileHash("AI", "野球")).not.toBe(base)
  })
})

describe("parseRetryAfterMs", () => {
  it("parses a numeric seconds header", () => {
    expect(parseRetryAfterMs("2")).toBe(2_000)
  })

  it("returns undefined for a missing header", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined()
  })
})

describe("fetchWithRetry", () => {
  it("waits according to Retry-After and retries once before succeeding", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "3" },
        })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue()

    const response = await fetchWithRetry(
      fetcher,
      "https://example.com",
      {},
      {
        maxAttempts: 3,
        sleep,
        defaultRetryAfterMs: 5_000,
        maxRetryAfterMs: 60_000,
      }
    )

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(3_000)
  })

  it("gives up after maxAttempts and returns the last 429 response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }))
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue()

    const response = await fetchWithRetry(
      fetcher,
      "https://example.com",
      {},
      {
        maxAttempts: 2,
        sleep,
        defaultRetryAfterMs: 1_000,
        maxRetryAfterMs: 60_000,
      }
    )

    expect(response.status).toBe(429)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it("caps the wait at maxRetryAfterMs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "9999" },
        })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue()

    await fetchWithRetry(
      fetcher,
      "https://example.com",
      {},
      {
        maxAttempts: 3,
        sleep,
        defaultRetryAfterMs: 1_000,
        maxRetryAfterMs: 10_000,
      }
    )

    expect(sleep).toHaveBeenCalledWith(10_000)
  })

  it("stops a rate-limit wait when the request is canceled", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }))
    const sleep = vi.fn<(ms: number) => Promise<void>>(
      () => new Promise(() => undefined)
    )
    const controller = new AbortController()
    const request = fetchWithRetry(
      fetcher,
      "https://example.com",
      { signal: controller.signal },
      {
        maxAttempts: 3,
        sleep,
        defaultRetryAfterMs: 60_000,
        maxRetryAfterMs: 60_000,
      }
    )

    controller.abort(new Error("canceled"))

    await expect(request).rejects.toThrow("canceled")
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
