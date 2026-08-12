import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { ArchiveArticlePorts } from "../application/ports.js"
import {
  archiveArticleFromUnknown,
  parseArchiveCapture,
  parseArchiveCommand,
} from "./archive-input.js"

const validCommand = {
  archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
  articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  sourceUrl: "https://news.example.com/posts/1",
  title: "Typed domain models",
}

const validCommandEnvelope = {
  messageId: "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4",
  correlationId: "ea122752-73d0-4851-9664-7d3e63e76859",
  causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
  occurredAt: "2026-08-12T00:00:00.000Z",
  producer: "gateway",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  actor: {
    _tag: "User",
    userId: "fbb2b8a9-8776-4513-bdff-d2e6fd3ec25c",
  },
  payload: validCommand,
}

const validCapture = {
  rawResponse: {
    _tag: "RawResponse",
    key: "articles/snapshot/raw/response.html",
    sha256: "1".repeat(64),
    mediaType: "text/html; charset=utf-8",
    byteLength: 120,
  },
  replay: {
    _tag: "Replay",
    key: "articles/snapshot/replay/index.html",
    sha256: "2".repeat(64),
    mediaType: "text/html; charset=utf-8",
    byteLength: 100,
  },
  markdown: {
    _tag: "Markdown",
    key: "articles/snapshot/markdown/article.md",
    sha256: "3".repeat(64),
    mediaType: "text/markdown; charset=utf-8",
    byteLength: 80,
  },
  assets: [],
}

describe("archive input parsers", () => {
  it("parses an unknown command into a deeply immutable trusted value", async () => {
    const parsed = await Effect.runPromise(parseArchiveCommand(validCommand))

    expect(parsed).toEqual(validCommand)
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it("does not invoke application ports when unknown input cannot be parsed", async () => {
    const lookup = vi.fn<ArchiveArticlePorts["lookup"]>()
    const ports = {
      lookup,
    } as unknown as ArchiveArticlePorts

    const exit = await Effect.runPromiseExit(
      archiveArticleFromUnknown(ports)({
        ...validCommandEnvelope,
        payload: { ...validCommand, title: "" },
      })
    )

    expect(exit._tag).toBe("Failure")
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each([
    [
      "unsupported URL scheme",
      { ...validCommand, sourceUrl: "ftp://example.com/a" },
    ],
    [
      "URL credentials",
      { ...validCommand, sourceUrl: "https://alice:secret@example.com/a" },
    ],
    [
      "URL fragment",
      { ...validCommand, sourceUrl: "https://example.com/a#part" },
    ],
    [
      "non-canonical URL",
      { ...validCommand, sourceUrl: "HTTPS://EXAMPLE.COM/a" },
    ],
    ["blank title", { ...validCommand, title: "  " }],
    ["excess property", { ...validCommand, debug: true }],
  ])("rejects %s", async (_case, input) => {
    const exit = await Effect.runPromiseExit(parseArchiveCommand(input))

    expect(exit._tag).toBe("Failure")
  })

  it("parses a complete tagged capture and freezes every nested value", async () => {
    const parsed = await Effect.runPromise(parseArchiveCapture(validCapture))

    expect(parsed.markdown._tag).toBe("Markdown")
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.rawResponse)).toBe(true)
    expect(Object.isFrozen(parsed.assets)).toBe(true)
  })

  it.each([
    [
      "missing mandatory markdown",
      {
        rawResponse: validCapture.rawResponse,
        replay: validCapture.replay,
        assets: [],
      },
    ],
    [
      "path traversal object key",
      {
        ...validCapture,
        markdown: { ...validCapture.markdown, key: "articles/../secret" },
      },
    ],
    [
      "malformed content hash",
      {
        ...validCapture,
        rawResponse: { ...validCapture.rawResponse, sha256: "DEADBEEF" },
      },
    ],
    [
      "duplicate object key",
      {
        ...validCapture,
        markdown: {
          ...validCapture.markdown,
          key: validCapture.replay.key,
        },
      },
    ],
    [
      "zero-byte mandatory artifact",
      {
        ...validCapture,
        replay: { ...validCapture.replay, byteLength: 0 },
      },
    ],
    [
      "markdown artifact with an image media type",
      {
        ...validCapture,
        markdown: { ...validCapture.markdown, mediaType: "image/png" },
      },
    ],
    [
      "replay artifact with a markdown media type",
      {
        ...validCapture,
        replay: { ...validCapture.replay, mediaType: "text/markdown" },
      },
    ],
  ])("rejects %s", async (_case, input) => {
    const exit = await Effect.runPromiseExit(parseArchiveCapture(input))

    expect(exit._tag).toBe("Failure")
  })
})
