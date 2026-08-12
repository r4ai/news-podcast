import { createHash } from "node:crypto"
import { createServer } from "node:http"

import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ArticleUrlSchema } from "../../domain/article.js"
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
  timeoutMillis: 1_000,
  maximumHtmlBytes: 4_096,
}

describe("HTTP to S3 article capture", () => {
  it("stores deterministic bounded artifacts with hashes through a real HTTP server", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8")
      response.end(
        "<!doctype html><title>Secret</title><script>alert(1)</script><article>Hello world</article>"
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

    const capture = await Effect.runPromise(resource.capture({ sourceUrl }))
    const prefix = createHash("sha256").update(sourceUrl).digest("hex")

    expect(objects.map(({ input }) => input.Key)).toEqual([
      `articles/${prefix}/raw/response.html`,
      `articles/${prefix}/replay/index.html`,
      `articles/${prefix}/markdown/article.md`,
    ])
    expect(capture.markdown.sha256).toHaveLength(64)
    expect(capture.markdown.byteLength).toBeGreaterThan(0)
    const replay = new TextDecoder().decode(objects[1]!.input.Body)
    expect(replay).toContain("Content-Security-Policy")
    expect(replay).not.toContain("<script>")
    await Effect.runPromise(resource.close)
    expect(closeS3).toHaveBeenCalledOnce()
    expect(closeFetch).toHaveBeenCalledOnce()
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
          })
        )
      )
      expect(error).toEqual({ _tag: "CaptureFailed", reason })
      expect(JSON.stringify(error)).not.toContain("secret")
    }
  )

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
          })
        )
      )
    ).toEqual({ _tag: "CaptureFailed", reason: "Blocked" })
  })
})
