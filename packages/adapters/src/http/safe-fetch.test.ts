import { describe, expect, it } from "vitest"

import { assertSafePublicUrl, createPinnedLookup } from "./safe-fetch.js"

describe("assertSafePublicUrl", () => {
  it.each([
    "http://127.0.0.1/private",
    "http://10.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/private",
    "http://[::ffff:7f00:1]/private",
    "http://192.0.2.1/documentation",
    "file:///etc/passwd",
  ])("rejects non-public URL %s", async (url) => {
    await expect(assertSafePublicUrl(url)).rejects.toThrow()
  })

  it("accepts a public HTTP address", async () => {
    await expect(
      assertSafePublicUrl("https://93.184.216.34/article")
    ).resolves.toEqual(new URL("https://93.184.216.34/article"))
  })
})

describe("createPinnedLookup", () => {
  it("returns the validated address even if DNS would later rebind", async () => {
    const pins = createPinnedLookup()
    const release = pins.pin("feed.example.com", [
      { address: "93.184.216.34", family: 4 },
    ])

    // The socket lookup has no resolver seam: it can only return the address
    // captured by the preceding safety check.
    await expect(runLookup(pins.lookup, "feed.example.com")).resolves.toEqual({
      address: "93.184.216.34",
      family: 4,
    })

    release()
    await expect(
      runLookup(pins.lookup, "feed.example.com")
    ).rejects.toMatchObject({
      code: "ENOTFOUND",
    })
  })

  it("fails closed when a hostname has no validated pin", async () => {
    const pins = createPinnedLookup()

    await expect(
      runLookup(pins.lookup, "rebound.example.com")
    ).rejects.toMatchObject({
      code: "ENOTFOUND",
    })
  })

  it("keeps IPv6 URL brackets out of the socket lookup key", async () => {
    const pins = createPinnedLookup()
    pins.pin("[2606:2800:220:1:248:1893:25c8:1946]", [
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ])

    await expect(
      runLookup(pins.lookup, "2606:2800:220:1:248:1893:25c8:1946")
    ).resolves.toEqual({
      address: "2606:2800:220:1:248:1893:25c8:1946",
      family: 6,
    })
  })

  it("keeps a concurrent pin active until its own request releases it", async () => {
    const pins = createPinnedLookup()
    const releaseFirst = pins.pin("feed.example.com", [
      { address: "93.184.216.34", family: 4 },
    ])
    const releaseSecond = pins.pin("feed.example.com", [
      { address: "93.184.216.35", family: 4 },
    ])

    releaseSecond()
    await expect(runLookup(pins.lookup, "feed.example.com")).resolves.toEqual({
      address: "93.184.216.34",
      family: 4,
    })
    releaseFirst()
    await expect(
      runLookup(pins.lookup, "feed.example.com")
    ).rejects.toMatchObject({
      code: "ENOTFOUND",
    })
  })

  it("fails closed above the concurrent hostname bound", () => {
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
    expect(() =>
      pins.pin("recovered.example.com", [
        { address: "93.184.216.34", family: 4 },
      ])
    ).not.toThrow()
  })
})

function runLookup(
  lookup: ReturnType<typeof createPinnedLookup>["lookup"],
  hostname: string
): Promise<{ readonly address: string; readonly family: number }> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: false }, (error, address, family) => {
      if (error) {
        reject(error)
        return
      }
      if (typeof address !== "string") {
        reject(new Error("Expected one address"))
        return
      }
      resolve({ address, family: family ?? 0 })
    })
  })
}
