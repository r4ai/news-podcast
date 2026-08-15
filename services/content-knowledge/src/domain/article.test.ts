import { deepFreeze } from "@news-podcast/kernel"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  ArchiveCaptureSchema,
  ArchiveRequestIdSchema,
  ArticleIdSchema,
  ArticleTitleSchema,
  ArticleUrlSchema,
  CapturedAtSchema,
  SnapshotIdSchema,
  createArticleSnapshot,
} from "./article.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
) => deepFreeze(Schema.decodeUnknownSync(schema)(input))

const command = deepFreeze({
  archiveRequestId: decode(
    ArchiveRequestIdSchema,
    "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93"
  ),
  articleId: decode(ArticleIdSchema, "5af55f2e-ff0b-475c-866a-f2cff48c101d"),
  sourceUrl: decode(ArticleUrlSchema, "https://news.example.com/posts/1"),
  title: decode(ArticleTitleSchema, "Typed domain models"),
})

const capture = decode(ArchiveCaptureSchema, {
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
  assets: [
    {
      _tag: "Asset",
      key: "articles/snapshot/assets/logo.png",
      sha256: "4".repeat(64),
      mediaType: "image/png",
      byteLength: 42,
    },
  ],
})

describe("article archive domain", () => {
  it("constructs a complete immutable snapshot", () => {
    const snapshot = createArticleSnapshot({
      command,
      snapshotId: decode(
        SnapshotIdSchema,
        "46c2eef5-a205-4526-8640-dc3ea84d88b4"
      ),
      capturedAt: decode(CapturedAtSchema, "2026-08-12T00:00:00.000Z"),
      capture,
    })
    expect(snapshot.capture.markdown._tag).toBe("Markdown")
    expect(snapshot).toMatchObject({
      articleId: command.articleId,
      snapshotId: snapshot.snapshotId,
      sourceUrl: command.sourceUrl,
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.capture)).toBe(true)
    expect(Object.isFrozen(snapshot.capture.assets)).toBe(true)
  })
})
