import type { LookupAddress } from "node:dns"

import { describe, expect, it, vi } from "vitest"

import {
  assertSafePublicUrl,
  createPinnedLookup,
  createSafeFetcher,
} from "./safe-fetch.js"

describe("Content safe HTTP boundary", () => {
  it.each([
    "http://127.0.0.1/private",
    "http://10.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/private",
    "http://[::ffff:7f00:1]/private",
    "http://192.0.2.1/documentation",
    "file:///etc/passwd",
    "https://user:password@example.com/private",
  ])("rejects a non-public URL: %s", async (url) => {
    await expect(assertSafePublicUrl(url)).rejects.toThrow()
  })

  it("rejects a hostname when any resolved address is private", async () => {
    const resolver = vi.fn(async (): Promise<readonly LookupAddress[]> => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])

    await expect(
      assertSafePublicUrl("https://news.example/article", resolver)
    ).rejects.toThrow("Private or reserved")
  })

  it("revalidates redirect destinations and blocks a private redirect", async () => {
    const baseFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      })
    )
    const fetcher = createSafeFetcher(baseFetch)

    await expect(fetcher("https://93.184.216.34/article")).rejects.toThrow(
      "Private or reserved"
    )
    expect(baseFetch).toHaveBeenCalledOnce()
    expect(baseFetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" })
  })

  it("bounds redirect chains", async () => {
    const baseFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "/again" } })
      )

    await expect(
      createSafeFetcher(baseFetch)("https://93.184.216.34/start")
    ).rejects.toThrow("Too many redirects")
    expect(baseFetch).toHaveBeenCalledTimes(6)
  })

  it("pins the validated address and fails closed after release", async () => {
    const pins = createPinnedLookup()
    const release = pins.pin("feed.example.com", [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(runLookup(pins, "feed.example.com")).resolves.toEqual({
      address: "93.184.216.34",
      family: 4,
    })
    release()
    await expect(runLookup(pins, "feed.example.com")).rejects.toMatchObject({
      code: "ENOTFOUND",
    })
  })

  it("bounds concurrently pinned hostnames", () => {
    const pins = createPinnedLookup()
    const releases = Array.from({ length: 1_024 }, (_, index) =>
      pins.pin(`feed-${index}.example.com`, [
        { address: "93.184.216.34", family: 4 },
      ])
    )

    expect(() =>
      pins.pin("overflow.example.com", [
        { address: "93.184.216.34", family: 4 },
      ])
    ).toThrow("Too many concurrently pinned hostnames")
    releases.forEach((release) => release())
  })
})

const runLookup = (
  pins: ReturnType<typeof createPinnedLookup>,
  hostname: string
): Promise<{ readonly address: string; readonly family: number }> =>
  new Promise((resolve, reject) => {
    pins.lookup(hostname, { all: false }, (error, address, family) => {
      if (error) return reject(error)
      if (typeof address !== "string") return reject(new Error("Expected IP"))
      resolve({ address, family: family ?? 0 })
    })
  })
