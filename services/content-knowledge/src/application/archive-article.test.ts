import { deepFreeze } from "@news-podcast/kernel"
import {
  ActorSchema,
  CorrelationIdSchema,
  MessageIdSchema,
  TraceparentSchema,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  ArchiveCaptureSchema,
  ArchiveCommandSchema,
  CapturedAtSchema,
  SnapshotIdSchema,
  createArticleSnapshot,
} from "../domain/article.js"
import { archiveArticle } from "./archive-article.js"
import type { ArchiveArticlePorts } from "./ports/archive.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
) => deepFreeze(Schema.decodeUnknownSync(schema)(input))

const command = decode(ArchiveCommandSchema, {
  archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
  articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  sourceUrl: "https://news.example.com/posts/1",
  title: "Typed domain models",
})
const context = deepFreeze({
  messageId: decode(MessageIdSchema, "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4"),
  correlationId: decode(
    CorrelationIdSchema,
    "ea122752-73d0-4851-9664-7d3e63e76859"
  ),
  traceparent: decode(
    TraceparentSchema,
    "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  ),
  actor: decode(ActorSchema, {
    _tag: "User",
    userId: "fbb2b8a9-8776-4513-bdff-d2e6fd3ec25c",
  }),
})
const invocation = deepFreeze({ command, context })
const snapshotId = decode(
  SnapshotIdSchema,
  "46c2eef5-a205-4526-8640-dc3ea84d88b4"
)
const capturedAt = decode(CapturedAtSchema, "2026-08-12T00:00:00.000Z")
const capture = decode(ArchiveCaptureSchema, {
  rawResponse: {
    _tag: "RawResponse",
    key: "articles/snapshot/raw/response.html",
    sha256: "1".repeat(64),
    mediaType: "text/html",
    byteLength: 120,
  },
  replay: {
    _tag: "Replay",
    key: "articles/snapshot/replay/index.html",
    sha256: "2".repeat(64),
    mediaType: "text/html",
    byteLength: 100,
  },
  markdown: {
    _tag: "Markdown",
    key: "articles/snapshot/markdown/article.md",
    sha256: "3".repeat(64),
    mediaType: "text/markdown",
    byteLength: 80,
  },
  assets: [],
})

const makePorts = (): ArchiveArticlePorts => {
  const lookup: ArchiveArticlePorts["lookup"] = vi.fn(() =>
    Effect.succeed(deepFreeze({ _tag: "NotArchived" as const }))
  )
  const captureArticle: ArchiveArticlePorts["capture"] = vi.fn(() =>
    Effect.succeed(capture)
  )
  const newSnapshotId: ArchiveArticlePorts["newSnapshotId"] = vi.fn(
    () => snapshotId
  )
  const now: ArchiveArticlePorts["now"] = vi.fn(() => capturedAt)
  const commit: ArchiveArticlePorts["commit"] = vi.fn(() =>
    Effect.succeed(deepFreeze({ _tag: "Committed" as const }))
  )
  return { lookup, capture: captureArticle, newSnapshotId, now, commit }
}

describe("archiveArticle", () => {
  it("captures, constructs and commits an immutable snapshot", async () => {
    const ports = makePorts()
    const result = await Effect.runPromise(archiveArticle(ports)(invocation))

    expect(result._tag).toBe("Archived")
    expect(ports.capture).toHaveBeenCalledWith({
      sourceUrl: command.sourceUrl,
      snapshotId,
    })
    expect(ports.commit).toHaveBeenCalledOnce()
    const commitCall = vi.mocked(ports.commit).mock.calls[0]?.[0]
    expect(commitCall).toEqual({
      snapshot: createArticleSnapshot({
        command,
        snapshotId,
        capturedAt,
        capture,
      }),
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(commitCall && Object.isFrozen(commitCall)).toBe(true)
  })

  it("returns the existing immutable snapshot without recapturing on retry", async () => {
    const existing = createArticleSnapshot({
      command,
      snapshotId,
      capturedAt,
      capture,
    })
    const ports = makePorts()
    vi.mocked(ports.lookup).mockReturnValue(
      Effect.succeed(deepFreeze({ _tag: "Archived", snapshot: existing }))
    )

    const result = await Effect.runPromise(archiveArticle(ports)(invocation))

    expect(result).toEqual({ _tag: "AlreadyArchived", snapshot: existing })
    expect(ports.capture).not.toHaveBeenCalled()
    expect(ports.commit).not.toHaveBeenCalled()
    expect(Object.isFrozen(result)).toBe(true)
  })

  it("maps a racing commit to the canonical existing snapshot", async () => {
    const existing = createArticleSnapshot({
      command,
      snapshotId,
      capturedAt,
      capture,
    })
    const ports = makePorts()
    vi.mocked(ports.commit).mockReturnValue(
      Effect.succeed(
        deepFreeze({ _tag: "AlreadyCommitted", snapshot: existing })
      )
    )

    const result = await Effect.runPromise(archiveArticle(ports)(invocation))

    expect(result).toEqual({ _tag: "AlreadyArchived", snapshot: existing })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it("does not call commit when capture fails", async () => {
    const ports = makePorts()
    vi.mocked(ports.capture).mockReturnValue(
      Effect.fail(deepFreeze({ _tag: "CaptureFailed", reason: "Unavailable" }))
    )

    const exit = await Effect.runPromiseExit(archiveArticle(ports)(invocation))

    expect(exit._tag).toBe("Failure")
    expect(ports.commit).not.toHaveBeenCalled()
  })
})
