import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  ArchiveCaptureSchema,
  ArchiveCommandSchema,
  CapturedAtSchema,
  SnapshotIdSchema,
  createArticleSnapshot,
} from "../domain/article.js"
import {
  parseJsonUnsafe,
  stringifyJsonUnsafe,
} from "../infrastructure/unsafe/json.js"
import { createArchiveStore } from "./persistence/archive/repository.js"
import { openTestDatabase } from "./persistence/testing.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
) => Schema.decodeUnknownSync(schema)(input)

const snapshot = createArticleSnapshot({
  command: decode(ArchiveCommandSchema, {
    archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
    articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
    sourceUrl: "https://news.example.com/posts/1",
    title: "Typed domain models",
  }),
  snapshotId: decode(SnapshotIdSchema, "46c2eef5-a205-4526-8640-dc3ea84d88b4"),
  capturedAt: decode(CapturedAtSchema, "2026-08-12T00:00:00.000Z"),
  capture: decode(ArchiveCaptureSchema, {
    rawResponse: {
      _tag: "RawResponse",
      key: "articles/a/raw.html",
      sha256: "1".repeat(64),
      mediaType: "text/html",
      byteLength: 10,
    },
    replay: {
      _tag: "Replay",
      key: "articles/a/replay.html",
      sha256: "2".repeat(64),
      mediaType: "text/html",
      byteLength: 10,
    },
    markdown: {
      _tag: "Markdown",
      key: "articles/a/article.md",
      sha256: "3".repeat(64),
      mediaType: "text/markdown",
      byteLength: 10,
    },
    assets: [],
  }),
})

describe("SQLite archive store", () => {
  it("saves an immutable snapshot idempotently without an outbox", async () => {
    const database = openTestDatabase()
    try {
      const store = await Effect.runPromise(
        createArchiveStore(database.db, {
          parse: parseJsonUnsafe,
          stringify: stringifyJsonUnsafe,
        })
      )

      expect(await Effect.runPromise(store.commit({ snapshot }))).toEqual({
        _tag: "Committed",
      })
      expect(await Effect.runPromise(store.commit({ snapshot }))).toEqual({
        _tag: "AlreadyCommitted",
        snapshot,
      })
      expect(
        await Effect.runPromise(store.lookup(snapshot.archiveRequestId))
      ).toEqual({
        _tag: "Archived",
        snapshot,
      })
      expect(
        await Effect.runPromise(store.listReferencedSnapshotIds())
      ).toEqual([snapshot.snapshotId])
      expect(
        database.getSql(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_outbox'"
        )
      ).toBeUndefined()
    } finally {
      database.close()
    }
  })
})
