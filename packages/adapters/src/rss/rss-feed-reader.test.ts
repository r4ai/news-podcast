import { describe, expect, it, vi } from "vitest"

import { RssFeedReader } from "./rss-feed-reader.js"

describe("RssFeedReader", () => {
  it("resolves relative Atom site and entry links against the feed URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>Example</title>
          <link rel="alternate" href="../" />
          <entry>
            <title>Relative article</title>
            <link href="../articles/one" />
            <updated>2026-08-11T00:00:00Z</updated>
          </entry>
        </feed>
      `)
    )

    const feed = await new RssFeedReader(fetcher).discover(
      "https://example.com/news/feed.xml"
    )

    expect(feed.siteUrl).toBe("https://example.com/")
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]?.url.href).toBe("https://example.com/articles/one")
  })

  it("drops non-HTTP article URLs supplied by a feed", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`
        <rss><channel><title>Example</title>
          <item><title>Unsafe</title><link>javascript:alert(1)</link></item>
        </channel></rss>
      `)
    )

    const feed = await new RssFeedReader(fetcher).discover(
      "https://example.com/feed.xml"
    )

    expect(feed.items).toEqual([])
  })

  it("rejects a feed whose declared response size exceeds 5 MiB", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", {
        headers: { "Content-Length": String(5 * 1024 * 1024 + 1) },
      })
    )

    await expect(
      new RssFeedReader(fetcher).discover("https://example.com/feed.xml")
    ).rejects.toThrow("RSS response exceeded 5 MiB")
  })

  it("stops reading when an undeclared response body exceeds 5 MiB", async () => {
    const body = new Uint8Array(5 * 1024 * 1024 + 1)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))

    await expect(
      new RssFeedReader(fetcher).discover("https://example.com/feed.xml")
    ).rejects.toThrow("RSS response exceeded 5 MiB")
  })
})
