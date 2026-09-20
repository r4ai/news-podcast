import { createServer } from "node:http"
import { gzipSync } from "node:zlib"

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ArticleUrlSchema, SnapshotIdSchema } from "../../domain/article.js"
import {
  MAXIMUM_ARTICLE_AST_NODES,
  MAXIMUM_ARTICLE_AST_DEPTH,
  MAXIMUM_ARTICLE_PARSER_INPUT_BYTES,
} from "./article-markdown-parser.js"
import { openHttpS3ArticleCaptureUnsafe } from "./http-s3-article-capture.js"

const servers: Array<ReturnType<typeof createServer>> = []
const REAL_HTTP_CAPTURE_TIMEOUT_MILLIS = 10_000
const REAL_HTTP_CAPTURE_TEST_TIMEOUT_MILLIS = 15_000
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
const config = {
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  bucket: "news-podcast",
  accessKeyId: "access",
  secretAccessKey: "secret",
  // The production archive deadline is 30 seconds. Keep the real-HTTP test
  // comfortably below that while allowing concurrent CI workers to schedule
  // the HTML, stylesheet, and image requests without aborting the capture.
  timeoutMillis: REAL_HTTP_CAPTURE_TIMEOUT_MILLIS,
  maximumHtmlBytes: 4_096,
}

describe("HTTP to S3 article capture", () => {
  it.each([
    {
      name: "attempt count",
      maximumAssetCount: 1,
      maximumAssetTotalBytes: 9,
      requests: 1,
    },
    {
      name: "decoded total bytes",
      maximumAssetCount: 3,
      maximumAssetTotalBytes: 4,
      requests: 2,
    },
  ])(
    "charges duplicate bodies against $name",
    async ({ maximumAssetCount, maximumAssetTotalBytes, requests }) => {
      let assetRequests = 0
      const stored = vi.fn()
      const resource = openHttpS3ArticleCaptureUnsafe(
        { ...config, maximumAssetCount, maximumAssetTotalBytes },
        {
          createS3: () => ({
            client: { send: stored } as never,
            close: () => undefined,
          }),
          createSafeFetch: () => ({
            fetch: (async (url: string) => {
              if (url.endsWith("/article"))
                return new Response(
                  '<article><h1>Article</h1><p>Content</p><img src="/a"><img src="/b"><img src="/c"></article>',
                  { headers: { "content-type": "text/html" } }
                )
              assetRequests += 1
              return new Response("abc", {
                headers: { "content-type": "image/png" },
              })
            }) as typeof fetch,
            close: async () => undefined,
          }),
        }
      )
      try {
        const error = await Effect.runPromise(
          Effect.flip(
            resource.capture({
              sourceUrl: "https://news.example.com/article" as never,
              snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
            })
          )
        )
        expect(error).toEqual({
          _tag: "CaptureFailed",
          reason: "ResourceLimit",
        })
        expect(assetRequests).toBe(requests)
        expect(stored).not.toHaveBeenCalled()
      } finally {
        await Effect.runPromise(resource.close)
      }
    }
  )

  it.each([
    {
      name: "same URL",
      html: '<img src="/a"><img src="/a">',
      count: 1,
      bytes: 3,
      status: 200,
      expectedRequests: 1,
      succeeds: true,
      css: false,
    },
    {
      name: "distinct duplicate bodies at exact limits",
      html: '<img src="/a"><img src="/b">',
      count: 2,
      bytes: 6,
      status: 200,
      expectedRequests: 2,
      succeeds: true,
      css: false,
    },
    {
      name: "failed optional attempts",
      html: '<img src="/a"><img src="/b">',
      count: 1,
      bytes: 6,
      status: 404,
      expectedRequests: 1,
      succeeds: false,
      css: false,
    },
    {
      name: "recursive duplicate CSS",
      html: '<link rel="stylesheet" href="/a/style.css">',
      count: 2,
      bytes: 1000,
      status: 200,
      expectedRequests: 2,
      succeeds: false,
      css: true,
    },
  ])(
    "bounds $name",
    async ({ html, count, bytes, status, expectedRequests, succeeds, css }) => {
      let requests = 0
      const assets = vi.fn()
      const resource = openHttpS3ArticleCaptureUnsafe(
        { ...config, maximumAssetCount: count, maximumAssetTotalBytes: bytes },
        {
          createS3: () => ({
            client: { send: async () => undefined } as never,
            close: () => undefined,
          }),
          createSafeFetch: () => ({
            fetch: (async (url: string) => {
              if (url.endsWith("/article"))
                return new Response(
                  `<article><h1>Article</h1><p>Content</p>${html}</article>`,
                  { headers: { "content-type": "text/html" } }
                )
              requests += 1
              return new Response(css ? '@import "nested/style.css";' : "abc", {
                status,
                headers: { "content-type": css ? "text/css" : "image/png" },
              })
            }) as typeof fetch,
            close: async () => undefined,
          }),
        },
        { cleanup: () => undefined, assets }
      )
      try {
        const effect = resource.capture({
          sourceUrl: "https://news.example.com/article" as never,
          snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
        })
        if (succeeds) {
          const result = await Effect.runPromise(effect)
          expect(result.assets).toHaveLength(1)
          expect(assets).toHaveBeenCalledWith({
            attempted: expectedRequests,
            downloadedBytes: expectedRequests * 3,
            retainedBytes: 3,
            limit: "none",
          })
        } else {
          expect(await Effect.runPromise(Effect.flip(effect))).toEqual({
            _tag: "CaptureFailed",
            reason: "ResourceLimit",
          })
          expect(assets).toHaveBeenCalledWith(
            expect.objectContaining({
              attempted: expectedRequests,
              limit: "count",
            })
          )
        }
        expect(requests).toBe(expectedRequests)
      } finally {
        await Effect.runPromise(resource.close)
      }
    }
  )

  it("rejects a stylesheet with excessive references during discovery", async () => {
    const css = Array.from(
      { length: 10 },
      (_, index) => `.a${index}{background:url("/r/${index}.png")}`
    ).join("")
    let requests = 0
    const assets = vi.fn()
    const resource = openHttpS3ArticleCaptureUnsafe(
      { ...config, maximumAssetCount: 3, maximumAssetTotalBytes: 100_000 },
      {
        createS3: () => ({
          client: { send: async () => undefined } as never,
          close: () => undefined,
        }),
        createSafeFetch: () => ({
          fetch: (async (url: string) => {
            if (url.endsWith("/article"))
              return new Response(
                '<article><h1>Article</h1><p>Content</p><link rel="stylesheet" href="/a/style.css"></article>',
                { headers: { "content-type": "text/html" } }
              )
            requests += 1
            return new Response(css, {
              headers: { "content-type": "text/css" },
            })
          }) as typeof fetch,
          close: async () => undefined,
        }),
      },
      { cleanup: () => undefined, assets }
    )
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          resource.capture({
            sourceUrl: "https://news.example.com/article" as never,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
          })
        )
      )
      expect(error).toEqual({ _tag: "CaptureFailed", reason: "ResourceLimit" })
      expect(assets).toHaveBeenCalledWith(
        expect.objectContaining({ attempted: 1, limit: "count" })
      )
      expect(requests).toBe(1)
    } finally {
      await Effect.runPromise(resource.close)
    }
  })

  it("rejects a stylesheet whose first new reference exhausts the shared budget", async () => {
    const css =
      '@import "new.css";' + '.a{background:url("/dup.png")}'.repeat(100)
    let requests = 0
    const assets = vi.fn()
    const resource = openHttpS3ArticleCaptureUnsafe(
      { ...config, maximumAssetCount: 3, maximumAssetTotalBytes: 100_000 },
      {
        createS3: () => ({
          client: { send: async () => undefined } as never,
          close: () => undefined,
        }),
        createSafeFetch: () => ({
          fetch: (async (url: string) => {
            if (url.endsWith("/article"))
              return new Response(
                '<article><h1>Article</h1><p>Content</p><link rel="stylesheet" href="/a/style.css"><img src="/i1.png"><img src="/i2.png"></article>',
                { headers: { "content-type": "text/html" } }
              )
            requests += 1
            if (url.endsWith(".css"))
              return new Response(css, {
                headers: { "content-type": "text/css" },
              })
            return new Response("abc", {
              headers: { "content-type": "image/png" },
            })
          }) as typeof fetch,
          close: async () => undefined,
        }),
      },
      { cleanup: () => undefined, assets }
    )
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          resource.capture({
            sourceUrl: "https://news.example.com/article" as never,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
          })
        )
      )
      expect(error).toEqual({ _tag: "CaptureFailed", reason: "ResourceLimit" })
      expect(assets).toHaveBeenCalledWith(
        expect.objectContaining({ attempted: 1, limit: "count" })
      )
      expect(requests).toBe(1)
    } finally {
      await Effect.runPromise(resource.close)
    }
  })

  it("charges decompressed bytes instead of compressed content-length", async () => {
    const compressed = gzipSync("a".repeat(2048))
    const server = createServer((request, response) => {
      if (request.url === "/article") {
        response.setHeader("content-type", "text/html")
        response.end(
          '<article><h1>Article</h1><p>Content</p><img src="/a"></article>'
        )
      } else {
        response.setHeader("content-type", "image/png")
        response.setHeader("content-encoding", "gzip")
        response.setHeader("content-length", compressed.byteLength)
        response.end(compressed)
      }
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string")
      throw new Error("missing address")
    const assets = vi.fn()
    const stored = vi.fn()
    const resource = openHttpS3ArticleCaptureUnsafe(
      { ...config, maximumAssetTotalBytes: 1024 },
      {
        createS3: () => ({
          client: { send: stored } as never,
          close: () => undefined,
        }),
        createSafeFetch: () => ({ fetch, close: async () => undefined }),
      },
      { cleanup: () => undefined, assets }
    )
    try {
      expect(
        await Effect.runPromise(
          Effect.flip(
            resource.capture({
              sourceUrl: `http://127.0.0.1:${address.port}/article` as never,
              snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
            })
          )
        )
      ).toEqual({ _tag: "CaptureFailed", reason: "ResourceLimit" })
      expect(assets).toHaveBeenCalledWith(
        expect.objectContaining({ downloadedBytes: 2048, limit: "total_bytes" })
      )
      expect(stored).not.toHaveBeenCalled()
    } finally {
      await Effect.runPromise(resource.close)
    }
  })

  it("accepts a compressed response whose decoded body fits the remaining budget", async () => {
    const compressed = gzipSync("abc")
    const server = createServer((request, response) => {
      if (request.url === "/article") {
        response.setHeader("content-type", "text/html")
        response.end(
          '<article><h1>Article</h1><p>Content</p><img src="/a"></article>'
        )
      } else {
        response.setHeader("content-type", "image/png")
        response.setHeader("content-encoding", "gzip")
        response.setHeader("content-length", compressed.byteLength)
        response.end(compressed)
      }
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string")
      throw new Error("missing address")
    const assets = vi.fn()
    const stored = vi.fn()
    const resource = openHttpS3ArticleCaptureUnsafe(
      { ...config, maximumAssetTotalBytes: 3 },
      {
        createS3: () => ({
          client: { send: stored } as never,
          close: () => undefined,
        }),
        createSafeFetch: () => ({ fetch, close: async () => undefined }),
      },
      { cleanup: () => undefined, assets }
    )
    try {
      const result = await Effect.runPromise(
        resource.capture({
          sourceUrl: `http://127.0.0.1:${address.port}/article` as never,
          snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
        })
      )
      expect(result.assets).toHaveLength(1)
      expect(assets).toHaveBeenCalledWith({
        attempted: 1,
        downloadedBytes: 3,
        retainedBytes: 3,
        limit: "none",
      })
    } finally {
      await Effect.runPromise(resource.close)
    }
  })

  it("deduplicates rewritten CSS before charging retained bytes", async () => {
    const css = "a{background:url(/i)}"
    const assets = vi.fn()
    const resource = openHttpS3ArticleCaptureUnsafe(
      { ...config, maximumAssetTotalBytes: Buffer.byteLength(css) * 3 + 3 },
      {
        createS3: () => ({
          client: { send: async () => undefined } as never,
          close: () => undefined,
        }),
        createSafeFetch: () => ({
          fetch: (async (url: string) => {
            if (url.endsWith("/article"))
              return new Response(
                '<article><h1>Article</h1><p>Content</p><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css"><link rel="stylesheet" href="/c.css"></article>',
                { headers: { "content-type": "text/html" } }
              )
            return new Response(url.endsWith(".css") ? css : "abc", {
              headers: {
                "content-type": url.endsWith(".css") ? "text/css" : "image/png",
              },
            })
          }) as typeof fetch,
          close: async () => undefined,
        }),
      },
      { cleanup: () => undefined, assets }
    )
    try {
      const result = await Effect.runPromise(
        resource.capture({
          sourceUrl: "https://news.example.com/article" as never,
          snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
        })
      )
      expect(result.assets).toHaveLength(2)
      expect(assets).toHaveBeenCalledWith(
        expect.objectContaining({ attempted: 4, limit: "none" })
      )
    } finally {
      await Effect.runPromise(resource.close)
    }
  })
  it(
    "stores deterministic bounded artifacts with hashes through a real HTTP server",
    async () => {
      const server = createServer((request, response) => {
        if (request.url === "/style.css") {
          response.setHeader("content-type", "text/css")
          response.end("article { color: navy; }")
          return
        }
        if (request.url === "/images/cover.png") {
          response.setHeader("content-type", "image/png")
          response.end(new Uint8Array([137, 80, 78, 71]))
          return
        }
        response.setHeader("content-type", "text/html; charset=utf-8")
        response.end(
          '<!doctype html><title>Secret</title><link rel="stylesheet" href="/style.css" integrity="sha384-stale"><script>alert(1)</script><article><h1>Hello world</h1><p>Read <strong>important</strong> <a href="/docs">guide</a> and <img src="/images/cover.png" alt="cover" />.</p><p><a href="javascript:alert(2)">unsafe</a></p><pre><code>const answer = 42</code></pre></article>'
        )
      })
      servers.push(server)
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
      )
      const address = server.address()
      if (address === null || typeof address === "string")
        throw new Error("missing address")
      const sourceUrl = Schema.decodeUnknownSync(ArticleUrlSchema)(
        `http://127.0.0.1:${address.port}/article`
      )
      const objects: Array<{
        input: { Key?: string; Body?: Uint8Array; ContentType?: string }
      }> = []
      const closeS3 = vi.fn()
      const closeFetch = vi.fn(async () => undefined)
      const resource = openHttpS3ArticleCaptureUnsafe(config, {
        createS3: () => ({
          client: {
            send: async (input: {
              input: { Key?: string; Body?: Uint8Array; ContentType?: string }
            }) => void objects.push(input),
          } as never,
          close: closeS3,
        }),
        createSafeFetch: () => ({ fetch, close: closeFetch }),
      })

      const snapshotId = Schema.decodeUnknownSync(SnapshotIdSchema)(
        "46c2eef5-a205-4526-8640-dc3ea84d88b4"
      )
      const capture = await Effect.runPromise(
        resource.capture({ sourceUrl, snapshotId })
      )

      expect(objects.map(({ input }) => input.Key)).toEqual([
        `articles/${snapshotId}/raw/response.html`,
        `articles/${snapshotId}/replay/index.html`,
        `articles/${snapshotId}/markdown/article.md`,
        expect.stringMatching(
          `^articles/${snapshotId}/assets/[a-f0-9]{64}\\.css$`
        ),
        expect.stringMatching(
          `^articles/${snapshotId}/assets/[a-f0-9]{64}\\.png$`
        ),
      ])
      expect(capture.markdown.sha256).toHaveLength(64)
      expect(capture.markdown.byteLength).toBeGreaterThan(0)
      const markdown = new TextDecoder().decode(objects[2]!.input.Body)
      expect(markdown).toContain("# Hello world")
      expect(markdown).toContain("**important**")
      expect(markdown).toContain(`[guide](${new URL("/docs", sourceUrl).href})`)
      expect(markdown).toContain(
        `![cover](${new URL("/images/cover.png", sourceUrl).href})`
      )
      expect(markdown).toContain("[unsafe]()")
      expect(markdown).not.toContain(`[unsafe](${sourceUrl})`)
      expect(markdown).toContain("const answer = 42")
      expect(markdown).not.toContain("alert(1)")
      const replay = new TextDecoder().decode(objects[1]!.input.Body)
      expect(replay).toContain("Content-Security-Policy")
      expect(replay).not.toContain("<script>")
      expect(replay).toContain("../assets/")
      expect(replay).not.toContain("integrity=")
      expect(capture.assets).toHaveLength(2)
      await Effect.runPromise(resource.close)
      expect(closeS3).toHaveBeenCalledOnce()
      expect(closeFetch).toHaveBeenCalledOnce()
    },
    REAL_HTTP_CAPTURE_TEST_TIMEOUT_MILLIS
  )

  it(
    "captures and rewrites recursive CSS dependencies and every srcset candidate",
    async () => {
      const server = createServer((request, response) => {
        if (request.url === "/root.css") {
          response.setHeader("content-type", "text/css")
          response.end(
            '@import "/theme.css"; article { background: url("/same.png") }'
          )
          return
        }
        if (request.url === "/theme.css") {
          response.setHeader("content-type", "text/css")
          response.end('@font-face { src: url("/font.woff2") }')
          return
        }
        if (request.url === "/font.woff2") {
          response.setHeader("content-type", "font/woff2")
          response.end(new Uint8Array([119, 79, 70, 50]))
          return
        }
        if (request.url === "/same.png" || request.url === "/large.png") {
          response.setHeader("content-type", "image/png")
          response.end(
            request.url === "/same.png"
              ? new Uint8Array([1, 2, 3])
              : new Uint8Array([4, 5, 6])
          )
          return
        }
        response.setHeader("content-type", "text/html")
        response.end(
          '<link rel="stylesheet" href="/root.css"><article><h1>Archive</h1><img srcset="/same.png 1x, /large.png 2x"></article>'
        )
      })
      servers.push(server)
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
      )
      const address = server.address()
      if (address === null || typeof address === "string")
        throw new Error("missing address")
      const sourceUrl = Schema.decodeUnknownSync(ArticleUrlSchema)(
        `http://127.0.0.1:${address.port}/article`
      )
      const objects: Array<{
        input: { Key?: string; Body?: Uint8Array; ContentType?: string }
      }> = []
      const resource = openHttpS3ArticleCaptureUnsafe(config, {
        createS3: () => ({
          client: {
            send: async (input: {
              input: { Key?: string; Body?: Uint8Array; ContentType?: string }
            }) => void objects.push(input),
          } as never,
          close: vi.fn(),
        }),
        createSafeFetch: () => ({ fetch, close: vi.fn(async () => undefined) }),
      })

      const capture = await Effect.runPromise(
        resource.capture({
          sourceUrl,
          snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
        })
      )

      expect(capture.assets).toHaveLength(5)
      const replay = new TextDecoder().decode(objects[1]!.input.Body)
      expect(replay).toMatch(
        /srcset="\.\.\/assets\/[a-f0-9]{64}\.png 1x, \.\.\/assets\/[a-f0-9]{64}\.png 2x"/
      )
      expect(replay).not.toContain(sourceUrl)
      const styles = objects
        .filter(({ input }) => input.ContentType === "text/css")
        .map(({ input }) => new TextDecoder().decode(input.Body))
      expect(styles).toHaveLength(2)
      expect(styles.join("\n")).toMatch(/@import "\.\/[a-f0-9]{64}\.css"/)
      expect(styles.join("\n")).toMatch(
        /url\("\.\/[a-f0-9]{64}\.(?:png|woff2)"\)/
      )
    },
    REAL_HTTP_CAPTURE_TEST_TIMEOUT_MILLIS
  )

  it.each([
    [
      "oversized",
      new Response("x".repeat(101), {
        headers: { "content-type": "text/html" },
      }),
      "ResourceLimit",
    ],
    [
      "not HTML",
      new Response("secret", {
        headers: { "content-type": "application/json" },
      }),
      "MalformedResponse",
    ],
  ])(
    "returns a redacted typed error for %s responses",
    async (_case, response, reason) => {
      const resource = openHttpS3ArticleCaptureUnsafe(
        { ...config, maximumHtmlBytes: 100 },
        {
          createS3: () => ({
            client: { send: vi.fn() } as never,
            close: vi.fn(),
          }),
          createSafeFetch: () => ({
            fetch: vi.fn(async () => response) as never,
            close: vi.fn(async () => undefined),
          }),
        }
      )
      const error = await Effect.runPromise(
        Effect.flip(
          resource.capture({
            sourceUrl: "https://news.example.com/secret" as never,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
          })
        )
      )
      expect(error).toEqual({ _tag: "CaptureFailed", reason })
      expect(JSON.stringify(error)).not.toContain("secret")
    }
  )

  it("rejects HTML over the parser input budget before storing artifacts", async () => {
    const send = vi.fn()
    const resource = openHttpS3ArticleCaptureUnsafe(
      {
        ...config,
        maximumHtmlBytes: MAXIMUM_ARTICLE_PARSER_INPUT_BYTES + 1,
      },
      {
        createS3: () => ({ client: { send } as never, close: vi.fn() }),
        createSafeFetch: () => ({
          fetch: vi.fn(
            async () =>
              new Response("x".repeat(MAXIMUM_ARTICLE_PARSER_INPUT_BYTES + 1), {
                headers: { "content-type": "text/html" },
              })
          ) as never,
          close: vi.fn(async () => undefined),
        }),
      }
    )

    expect(
      await Effect.runPromise(
        Effect.flip(
          resource.capture({
            sourceUrl:
              "https://news.example.com/oversized-parser-input" as never,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
          })
        )
      )
    ).toEqual({ _tag: "CaptureFailed", reason: "ResourceLimit" })
    expect(send).not.toHaveBeenCalled()
  })

  it("rejects excessive AST nodes before storing artifacts", async () => {
    const send = vi.fn()
    const resource = openHttpS3ArticleCaptureUnsafe(
      { ...config, maximumHtmlBytes: MAXIMUM_ARTICLE_PARSER_INPUT_BYTES },
      {
        createS3: () => ({ client: { send } as never, close: vi.fn() }),
        createSafeFetch: () => ({
          fetch: vi.fn(
            async () =>
              new Response("<p>x</p>".repeat(MAXIMUM_ARTICLE_AST_NODES + 1), {
                headers: { "content-type": "text/html" },
              })
          ) as never,
          close: vi.fn(async () => undefined),
        }),
      }
    )

    expect(
      await Effect.runPromise(
        Effect.flip(
          resource.capture({
            sourceUrl: "https://news.example.com/too-many-nodes" as never,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
          })
        )
      )
    ).toEqual({ _tag: "CaptureFailed", reason: "ResourceLimit" })
    expect(send).not.toHaveBeenCalled()
  })

  it("rejects excessive HTML nesting before Markdown conversion", async () => {
    const send = vi.fn()
    const html =
      "<div>".repeat(MAXIMUM_ARTICLE_AST_DEPTH + 1) +
      "x" +
      "</div>".repeat(MAXIMUM_ARTICLE_AST_DEPTH + 1)
    const resource = openHttpS3ArticleCaptureUnsafe(
      {
        ...config,
        maximumHtmlBytes: new TextEncoder().encode(html).byteLength,
      },
      {
        createS3: () => ({ client: { send } as never, close: vi.fn() }),
        createSafeFetch: () => ({
          fetch: vi.fn(
            async () =>
              new Response(html, { headers: { "content-type": "text/html" } })
          ) as never,
          close: vi.fn(async () => undefined),
        }),
      }
    )

    await expect(
      Effect.runPromise(
        Effect.flip(
          resource.capture({
            sourceUrl: "https://news.example.com/too-deep" as never,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
          })
        )
      )
    ).resolves.toEqual({ _tag: "CaptureFailed", reason: "ResourceLimit" })
    expect(send).not.toHaveBeenCalled()
  })

  it("settles every artifact write and deletes successful keys after a partial S3 failure", async () => {
    const written: string[] = []
    const deleted: string[] = []
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const key = command.input.Key!
        written.push(key)
        if (key.endsWith("/replay/index.html")) throw new Error("put failed")
        return {}
      }
      if (command instanceof DeleteObjectCommand) {
        deleted.push(command.input.Key!)
        return {}
      }
      throw new Error("unexpected S3 command")
    })
    const resource = openHttpS3ArticleCaptureUnsafe(config, {
      createS3: () => ({ client: { send } as never, close: vi.fn() }),
      createSafeFetch: () => ({
        fetch: vi.fn(
          async () =>
            new Response("<article><h1>Cleanup</h1></article>", {
              headers: { "content-type": "text/html" },
            })
        ) as never,
        close: vi.fn(async () => undefined),
      }),
    })

    await expect(
      Effect.runPromise(
        Effect.flip(
          resource.capture({
            sourceUrl: "https://news.example.com/partial" as never,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
          })
        )
      )
    ).resolves.toEqual({ _tag: "CaptureFailed", reason: "Unavailable" })
    expect(written).toEqual([
      "articles/46c2eef5-a205-4526-8640-dc3ea84d88b4/raw/response.html",
      "articles/46c2eef5-a205-4526-8640-dc3ea84d88b4/replay/index.html",
      "articles/46c2eef5-a205-4526-8640-dc3ea84d88b4/markdown/article.md",
    ])
    expect(deleted).toEqual([
      "articles/46c2eef5-a205-4526-8640-dc3ea84d88b4/raw/response.html",
      "articles/46c2eef5-a205-4526-8640-dc3ea84d88b4/markdown/article.md",
    ])
  })

  it("sweeps only expired snapshot prefixes that have no database reference", async () => {
    const referenced = "46c2eef5-a205-4526-8640-dc3ea84d88b4"
    const orphan = "2b949c5b-a79f-45f3-8b4b-8f1ea62ad23f"
    const recent = "b98ac5ca-2b33-40e8-8173-69f875782d11"
    const deleted: string[] = []
    const cleanup = vi.fn()
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        if (command.input.ContinuationToken === "page-2") {
          return {
            Contents: [
              {
                Key: `articles/${orphan}/markdown/article.md`,
                LastModified: new Date("2026-08-17T00:00:00.000Z"),
              },
            ],
            IsTruncated: false,
          }
        }
        return {
          Contents: [
            {
              Key: `articles/${referenced}/raw/response.html`,
              LastModified: new Date("2026-08-17T00:00:00.000Z"),
            },
            {
              Key: `articles/${orphan}/raw/response.html`,
              LastModified: new Date("2026-08-17T00:00:00.000Z"),
            },
            {
              Key: `articles/${recent}/raw/response.html`,
              LastModified: new Date("2026-08-19T11:59:59.000Z"),
            },
            {
              Key: "articles/not-a-snapshot/raw/response.html",
              LastModified: new Date("2026-08-17T00:00:00.000Z"),
            },
          ],
          IsTruncated: true,
          NextContinuationToken: "page-2",
        }
      }
      if (command instanceof DeleteObjectCommand) {
        const key = command.input.Key!
        deleted.push(key)
        if (key.endsWith("/markdown/article.md")) {
          throw new Error("delete failed")
        }
        return {}
      }
      throw new Error("unexpected S3 command")
    })
    const resource = openHttpS3ArticleCaptureUnsafe(
      config,
      {
        createS3: () => ({ client: { send } as never, close: vi.fn() }),
        createSafeFetch: () => ({
          fetch: vi.fn() as never,
          close: vi.fn(async () => undefined),
        }),
      },
      { cleanup }
    )

    const outcome = await Effect.runPromise(
      resource.cleanupOrphans({
        referencedSnapshotIds: new Set([referenced]),
        olderThan: new Date("2026-08-19T00:00:00.000Z"),
      })
    )

    expect(deleted).toEqual([
      `articles/${orphan}/raw/response.html`,
      `articles/${orphan}/markdown/article.md`,
    ])
    expect(outcome).toEqual({
      trigger: "retention_sweep",
      attempted: 2,
      deleted: 1,
      failed: 1,
    })
    expect(cleanup).toHaveBeenCalledWith(outcome)
  })

  it("classifies the safe-fetch SSRF denial without leaking its target", async () => {
    const resource = openHttpS3ArticleCaptureUnsafe(config, {
      createS3: () => ({ client: { send: vi.fn() } as never, close: vi.fn() }),
      createSafeFetch: () => ({
        fetch: vi.fn(async () => {
          throw new Error("Private or reserved addresses are not allowed")
        }) as never,
        close: vi.fn(async () => undefined),
      }),
    })
    expect(
      await Effect.runPromise(
        Effect.flip(
          resource.capture({
            sourceUrl: "https://internal.example.com/secret" as never,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
          })
        )
      )
    ).toEqual({ _tag: "CaptureFailed", reason: "Blocked" })
  })

  it("aborts an outbound request at the configured deadline", async () => {
    const resource = openHttpS3ArticleCaptureUnsafe(
      { ...config, timeoutMillis: 5 },
      {
        createS3: () => ({
          client: { send: vi.fn() } as never,
          close: vi.fn(),
        }),
        createSafeFetch: () => ({
          fetch: vi.fn(
            (_input, init) =>
              new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener(
                  "abort",
                  () => reject(init.signal?.reason),
                  { once: true }
                )
              })
          ) as never,
          close: vi.fn(async () => undefined),
        }),
      }
    )

    await expect(
      Effect.runPromise(
        Effect.flip(
          resource.capture({
            sourceUrl: "https://news.example.com/slow" as never,
            snapshotId: "46c2eef5-a205-4526-8640-dc3ea84d88b4" as never,
          })
        )
      )
    ).resolves.toEqual({ _tag: "CaptureFailed", reason: "Unavailable" })
  })
})
