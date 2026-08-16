import { createServer } from "node:http"

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
  timeoutMillis: 10_000,
  maximumHtmlBytes: 4_096,
}

describe("HTTP to S3 article capture", () => {
  it("stores deterministic bounded artifacts with hashes through a real HTTP server", async () => {
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
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
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
  })

  it("captures and rewrites recursive CSS dependencies and every srcset candidate", async () => {
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
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
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
  })

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
