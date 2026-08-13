import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  MAXIMUM_MARKDOWN_BYTES,
  openS3MarkdownObjectReaderUnsafe,
} from "./s3-markdown-object-reader.js"

const config = {
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  bucket: "news-podcast",
  accessKeyId: "access",
  secretAccessKey: "secret",
  timeoutMillis: 1_000,
}

describe("S3 Markdown object reader", () => {
  it("reads a bounded Markdown object and closes its client", async () => {
    const close = vi.fn()
    const send = vi.fn(async () => ({
      ContentLength: 8,
      ContentType: "text/markdown; charset=utf-8",
      Body: {
        transformToByteArray: async () => new TextEncoder().encode("# Article"),
      },
    }))
    const resource = openS3MarkdownObjectReaderUnsafe(config, () => ({
      client: { send } as never,
      close,
    }))

    expect(
      await Effect.runPromise(
        resource.reader.read("articles/a/article.md" as never)
      )
    ).toBe("# Article")
    await Effect.runPromise(resource.close)
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    [
      "wrong media type",
      { ContentType: "application/octet-stream", ContentLength: 1, Body: {} },
      "CorruptObject",
    ],
    [
      "declared too large",
      {
        ContentType: "text/markdown",
        ContentLength: MAXIMUM_MARKDOWN_BYTES + 1,
        Body: {},
      },
      "ResourceLimit",
    ],
    [
      "missing body",
      { ContentType: "text/markdown", ContentLength: 1 },
      "NotFound",
    ],
  ])(
    "rejects %s without exposing provider details",
    async (_name, response, reason) => {
      const resource = openS3MarkdownObjectReaderUnsafe(config, () => ({
        client: { send: async () => response } as never,
        close: vi.fn(),
      }))
      expect(
        await Effect.runPromise(
          Effect.flip(resource.reader.read("articles/a/article.md" as never))
        )
      ).toEqual({
        _tag: "MarkdownObjectFailed",
        reason,
      })
    }
  )

  it("stops an undeclared streaming body at the byte limit", async () => {
    async function* body() {
      yield new Uint8Array(MAXIMUM_MARKDOWN_BYTES)
      yield new Uint8Array([1])
      throw new Error("must not continue")
    }
    const resource = openS3MarkdownObjectReaderUnsafe(config, () => ({
      client: {
        send: async () => ({ ContentType: "text/markdown", Body: body() }),
      } as never,
      close: vi.fn(),
    }))

    expect(
      await Effect.runPromise(
        Effect.flip(resource.reader.read("articles/a/article.md" as never))
      )
    ).toEqual({ _tag: "MarkdownObjectFailed", reason: "ResourceLimit" })
  })

  it("aborts an Object Store request at the configured deadline", async () => {
    const resource = openS3MarkdownObjectReaderUnsafe(
      { ...config, timeoutMillis: 1 },
      () => ({
        client: {
          send: async (
            _command: unknown,
            options: { abortSignal: AbortSignal }
          ) =>
            new Promise((_resolve, reject) =>
              options.abortSignal.addEventListener(
                "abort",
                () => reject(new Error("timed out")),
                { once: true }
              )
            ),
        } as never,
        close: vi.fn(),
      })
    )

    expect(
      await Effect.runPromise(
        Effect.flip(resource.reader.read("articles/a/article.md" as never))
      )
    ).toEqual({ _tag: "MarkdownObjectFailed", reason: "Unavailable" })
  })
})
