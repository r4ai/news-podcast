import { describe, expect, it } from "vitest"
import {
  createLinkCardResolver,
  parseLinkCardMetadata,
} from "./link-card-metadata.js"
const base = new URL("https://example.com/redirected/page")
// OGP -> rich preview; absent tags -> title/hostname; failed fetch -> undefined.
describe("link metadata", () => {
  it("prefers Open Graph, decodes entities, and resolves relative images", () => {
    expect(
      parseLinkCardMetadata(
        '<title>Fallback</title><meta property="og:title" content="A &amp; B"><meta name="description" content="Summary"><meta property="og:image" content="../og.png">',
        base
      )
    ).toEqual({
      title: "A & B",
      description: "Summary",
      image: "https://example.com/og.png",
    })
  })
  it.each(["javascript:x", "http://user:pass@example.com/x", "http://["])(
    "rejects unsafe image %s",
    (image) => {
      expect(
        parseLinkCardMetadata(
          `<title>Fallback</title><meta property="og:image" content="${image}">`,
          base
        )
      ).toEqual({ title: "Fallback" })
    }
  )
  it("falls back to Twitter metadata or hostname", () => {
    expect(
      parseLinkCardMetadata(
        '<meta name="twitter:title" content="Tweet"><meta name="twitter:image" content="/image">',
        base
      ).title
    ).toBe("Tweet")
    expect(parseLinkCardMetadata("", base)).toEqual({ title: "example.com" })
  })
  it("uses bounded text", () => {
    expect(
      parseLinkCardMetadata(`<title>${"x".repeat(600)}</title>`, base).title
    ).toHaveLength(256)
  })
  it.each([200, 404, 503])(
    "reads successful HTML and treats status %s as optional",
    async (status) => {
      const calls: string[] = []
      const outcomes: string[] = []
      const resolver = createLinkCardResolver({
        fetcher: (async (url, init) => {
          calls.push(String(url))
          expect(init?.signal).toBeInstanceOf(AbortSignal)
          return new Response("<title>Title</title>", {
            status,
            headers: { "content-type": "text/html" },
          })
        }) as typeof fetch,
        readResponse: async (response) =>
          new Uint8Array(await response.arrayBuffer()),
        signal: new AbortController().signal,
        observe: (o) => outcomes.push(o),
      })
      expect(await resolver(base.href)).toEqual(
        status === 200 ? { title: "Title" } : undefined
      )
      expect(calls).toEqual([base.href])
      expect(outcomes).toEqual([status === 200 ? "succeeded" : "unavailable"])
    }
  )
  it("survives byte limits and blocked requests", async () => {
    const resolver = createLinkCardResolver({
      fetcher: (async () => {
        throw Error("Blocked private host")
      }) as typeof fetch,
      readResponse: async () => {
        throw Error("limit")
      },
      signal: new AbortController().signal,
      observe: () => {
        throw Error("telemetry")
      },
    })
    expect(await resolver("http://127.0.0.1")).toBeUndefined()
  })
  it("does not fetch after cancellation", async () => {
    const controller = new AbortController()
    controller.abort()
    let called = false
    const resolver = createLinkCardResolver({
      fetcher: (async () => {
        called = true
        return new Response("")
      }) as typeof fetch,
      readResponse: async () => new Uint8Array(),
      signal: controller.signal,
    })
    expect(await resolver(base.href)).toBeUndefined()
    expect(called).toBe(false)
  })
})

it.each(["non-html", "byte-limit"])(
  "keeps %s preview failures optional",
  async (kind) => {
    let read = false
    const resolve = createLinkCardResolver({
      fetcher: (async () =>
        new Response("body", {
          headers: {
            "content-type": kind === "non-html" ? "image/png" : "text/html",
          },
        })) as typeof fetch,
      readResponse: async () => {
        read = true
        throw Error("ResourceLimit")
      },
      signal: new AbortController().signal,
    })
    expect(await resolve("https://example.com")).toBeUndefined()
    expect(read).toBe(kind === "byte-limit")
  }
)
