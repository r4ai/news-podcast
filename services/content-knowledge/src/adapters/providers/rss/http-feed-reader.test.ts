import { createServer, type RequestListener } from "node:http"

import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { FeedUrlSchema } from "../../../domain/subscription.js"
import { parseRssFeed } from "./feed-parser.js"
import { createHttpRssFeedReader } from "./http-feed-reader.js"

const servers: Array<ReturnType<typeof createServer>> = []
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve()))
      )
  )
})

const serve = async (handler: RequestListener) => {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string")
    throw new Error("missing address")
  return Schema.decodeUnknownSync(FeedUrlSchema)(
    `http://127.0.0.1:${address.port}/feed.xml`
  )
}

describe("HTTP RSS feed reader", () => {
  it("reads RSS and Atom item links through a real HTTP server", async () => {
    const url = await serve((_request, response) => {
      response.setHeader("content-type", "application/rss+xml")
      response.end(`<?xml version="1.0"?><rss><channel><item>
        <guid>entry-1</guid><title>One &amp; Two</title><link>/articles/1</link>
      </item></channel></rss>`)
    })
    const reader = createHttpRssFeedReader({
      timeoutMillis: 1_000,
      maximumBytes: 8_192,
    })

    const { items } = await Effect.runPromise(reader.read(url))

    expect(items).toEqual([
      {
        externalId: "entry-1",
        captureFingerprint: expect.stringMatching(/^[\da-f]{64}$/),
        title: "One & Two",
        url: new URL("/articles/1", url).href,
      },
    ])
  })

  it("preserves RSS item values wrapped in CDATA", async () => {
    const url = await serve((_request, response) => {
      response.setHeader("content-type", "application/rss+xml")
      response.end(`<?xml version="1.0"?><rss><channel><item>
        <guid><![CDATA[https://example.com/articles/1]]></guid>
        <title><![CDATA[CDATA title]]></title>
        <link><![CDATA[https://example.com/articles/1]]></link>
      </item></channel></rss>`)
    })
    const reader = createHttpRssFeedReader({
      timeoutMillis: 1_000,
      maximumBytes: 8_192,
    })

    const { items } = await Effect.runPromise(reader.read(url))

    expect(items).toEqual([
      {
        externalId: "https://example.com/articles/1",
        captureFingerprint: expect.stringMatching(/^[\da-f]{64}$/),
        title: "CDATA title",
        url: "https://example.com/articles/1",
      },
    ])
  })

  it("supports RSS 1.0 RDF feeds and numeric XML entities", async () => {
    const url = await serve((_request, response) => {
      response.setHeader("content-type", "application/rdf+xml")
      response.end(`<?xml version="1.0"?>
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
          xmlns="http://purl.org/rss/1.0/">
          <channel><title>News</title></channel>
          <item rdf:about="https://example.com/articles/1">
            <title>One &#x26; Two</title>
            <link>https://example.com/articles/1</link>
          </item>
        </rdf:RDF>`)
    })
    const reader = createHttpRssFeedReader({
      timeoutMillis: 1_000,
      maximumBytes: 8_192,
    })

    const { items } = await Effect.runPromise(reader.read(url))

    expect(items).toEqual([
      {
        externalId: "https://example.com/articles/1",
        captureFingerprint: expect.stringMatching(/^[\da-f]{64}$/),
        title: "One & Two",
        url: "https://example.com/articles/1",
      },
    ])
  })

  it("does not terminate an item on an item-like closing tag inside CDATA", async () => {
    const url = await serve((_request, response) => {
      response.setHeader("content-type", "application/rss+xml")
      response.end(`<rss><channel><item>
        <guid>entry-1</guid>
        <title>Stable</title>
        <description><![CDATA[example text </item> remains data]]></description>
        <link>https://example.com/articles/1</link>
      </item></channel></rss>`)
    })
    const reader = createHttpRssFeedReader({
      timeoutMillis: 1_000,
      maximumBytes: 8_192,
    })

    const { items } = await Effect.runPromise(reader.read(url))

    expect(items).toEqual([
      {
        externalId: "entry-1",
        captureFingerprint: expect.stringMatching(/^[\da-f]{64}$/),
        title: "Stable",
        url: "https://example.com/articles/1",
      },
    ])
  })

  it("changes the capture fingerprint when same-GUID RSS content is updated", async () => {
    let version = "v1"
    const url = await serve((_request, response) => {
      response.setHeader("content-type", "application/rss+xml")
      response.end(`<rss><channel><item>
        <guid>entry-1</guid><title>Stable identity</title>
        <description>Body ${version}</description>
        <link>https://example.com/articles/1</link>
      </item></channel></rss>`)
    })
    const reader = createHttpRssFeedReader({
      timeoutMillis: 1_000,
      maximumBytes: 8_192,
    })

    const first = (await Effect.runPromise(reader.read(url))).items[0]!
    const retry = (await Effect.runPromise(reader.read(url))).items[0]!
    version = "v2"
    const updated = (await Effect.runPromise(reader.read(url))).items[0]!

    expect(retry.captureFingerprint).toBe(first.captureFingerprint)
    expect(updated.externalId).toBe(first.externalId)
    expect(updated.captureFingerprint).not.toBe(first.captureFingerprint)
    expect(first.captureFingerprint).toMatch(/^[\da-f]{64}$/)
  })

  it("fingerprints structured Atom content attributes and element names", async () => {
    let href = "https://example.com/v1"
    const url = await serve((_request, response) => {
      response.setHeader("content-type", "application/atom+xml")
      response.end(`<feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <id>entry-1</id><title>Stable</title>
        <link href="https://example.com/article"/>
        <content type="xhtml"><div><a href="${href}">same text</a></div></content>
      </entry></feed>`)
    })
    const reader = createHttpRssFeedReader({
      timeoutMillis: 1_000,
      maximumBytes: 8_192,
    })

    const first = (await Effect.runPromise(reader.read(url))).items[0]!
    href = "https://example.com/v2"
    const updated = (await Effect.runPromise(reader.read(url))).items[0]!

    expect(updated.captureFingerprint).not.toBe(first.captureFingerprint)
  })

  it("supports namespaced Atom entries and chooses the alternate link", async () => {
    const url = await serve((_request, response) => {
      response.setHeader("content-type", "application/atom+xml")
      response.end(`<?xml version="1.0"?>
        <atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
          <atom:entry>
            <atom:id>tag:example.com,2026:1</atom:id>
            <atom:title>Atom item</atom:title>
            <atom:link rel="self" href="https://example.com/feed.xml"/>
            <atom:link rel="alternate" type="text/html" href="/articles/1"/>
            <atom:updated>2026-08-13T01:00:00Z</atom:updated>
          </atom:entry>
        </atom:feed>`)
    })
    const reader = createHttpRssFeedReader({
      timeoutMillis: 1_000,
      maximumBytes: 8_192,
    })

    const { items } = await Effect.runPromise(reader.read(url))

    expect(items).toEqual([
      {
        externalId: "tag:example.com,2026:1",
        captureFingerprint: expect.stringMatching(/^[\da-f]{64}$/),
        title: "Atom item",
        url: new URL("/articles/1", url).href,
        publishedAt: "2026-08-13T01:00:00.000Z",
      },
    ])
  })

  it("rejects an XML document with a feed-looking but malformed structure", async () => {
    const url = await serve((_request, response) => {
      response.setHeader("content-type", "application/rss+xml")
      response.end("<rss><channel><item><title>Broken</channel></rss>")
    })
    const reader = createHttpRssFeedReader({
      timeoutMillis: 1_000,
      maximumBytes: 8_192,
    })

    const error = await Effect.runPromise(Effect.flip(reader.read(url)))

    expect(error).toEqual({
      _tag: "FeedFetchFailed",
      reason: "MalformedResponse",
    })
  })

  it("returns redacted typed failures for status, size, timeout, and malformed XML", async () => {
    const cases = [
      {
        expected: "HttpStatus",
        url: await serve((_request, response) => {
          response.statusCode = 503
          response.end("upstream secret")
        }),
        config: { timeoutMillis: 1_000, maximumBytes: 100 },
      },
      {
        expected: "ResourceLimit",
        url: await serve((_request, response) => {
          response.end("x".repeat(101))
        }),
        config: { timeoutMillis: 1_000, maximumBytes: 100 },
      },
      {
        expected: "Timeout",
        url: await serve(() => undefined),
        config: { timeoutMillis: 10, maximumBytes: 100 },
      },
      {
        expected: "MalformedResponse",
        url: await serve((_request, response) => {
          response.end("<html>not a feed</html>")
        }),
        config: { timeoutMillis: 1_000, maximumBytes: 100 },
      },
    ]

    for (const testCase of cases) {
      const error = await Effect.runPromise(
        Effect.flip(createHttpRssFeedReader(testCase.config).read(testCase.url))
      )
      expect(error).toEqual({
        _tag: "FeedFetchFailed",
        reason: testCase.expected,
      })
      expect(JSON.stringify(error)).not.toContain("secret")
      expect(JSON.stringify(error)).not.toContain(String(testCase.url))
    }
  })
})

describe("RSS item validation", () => {
  const feedUrl = Schema.decodeUnknownSync(FeedUrlSchema)(
    "https://feeds.example.com/news.xml"
  )

  it.each([
    {
      name: "missing title",
      item: "<guid>entry-1</guid><link>https://example.com/1</link>",
      reason: "MissingTitle",
    },
    {
      name: "missing link",
      item: "<guid>entry-1</guid><title>Missing link</title>",
      reason: "MissingLink",
    },
    {
      name: "non-HTTP URL",
      item: "<guid>entry-1</guid><title>Invalid URL</title><link>file:///secret</link>",
      reason: "InvalidUrl",
    },
    {
      name: "title longer than 500 characters",
      item: `<guid>entry-1</guid><title>${"x".repeat(501)}</title><link>https://example.com/1</link>`,
      reason: "TitleTooLong",
    },
  ])("reports a sanitized reason for $name", ({ item, reason }) => {
    const result = parseRssFeed(
      `<rss><channel><item>${item}</item></channel></rss>`,
      feedUrl
    )

    expect(result).toEqual({
      items: [],
      failures: [{ _tag: "FeedItemValidationFailed", reason }],
    })
    expect(JSON.stringify(result)).not.toContain("file:///secret")
  })

  it("keeps valid items while reporting invalid siblings", () => {
    const result = parseRssFeed(
      `<rss><channel>
        <item><guid>valid</guid><title>Valid</title><link>https://example.com/valid</link></item>
        <item><guid>invalid</guid><title>Missing link</title></item>
      </channel></rss>`,
      feedUrl
    )

    expect(result.items).toEqual([
      expect.objectContaining({
        externalId: "valid",
        title: "Valid",
        url: "https://example.com/valid",
      }),
    ])
    expect(result.failures).toEqual([
      { _tag: "FeedItemValidationFailed", reason: "MissingLink" },
    ])
  })
})
