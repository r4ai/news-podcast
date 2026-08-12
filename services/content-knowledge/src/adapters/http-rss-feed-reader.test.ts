import { createServer, type RequestListener } from "node:http"

import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { FeedUrlSchema } from "../domain/subscription.js"
import { createHttpRssFeedReader } from "./http-rss-feed-reader.js"

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

    const items = await Effect.runPromise(reader.read(url))

    expect(items).toEqual([
      {
        externalId: "entry-1",
        title: "One & Two",
        url: new URL("/articles/1", url).href,
      },
    ])
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
