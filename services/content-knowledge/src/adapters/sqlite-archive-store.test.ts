import { deepFreeze } from "@news-podcast/kernel"
import {
  ActorSchema,
  CorrelationIdSchema,
  MessageIdSchema,
  TraceparentSchema,
  parseArticleArchived,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  ArchiveCaptureSchema,
  ArchiveCommandSchema,
  CapturedAtSchema,
  SnapshotIdSchema,
  createArticleArchived,
  createArticleSnapshot,
} from "../domain/article.js"
import {
  parseJsonUnsafe,
  stringifyJsonUnsafe,
} from "../infrastructure/unsafe/json.js"
import { openTestDatabase } from "./persistence/testing.js"
import { parseOutboxLimit } from "./messaging/outbox.js"
import { createArchiveStore } from "./persistence/archive/repository.js"

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
const snapshot = createArticleSnapshot({
  command,
  snapshotId: decode(SnapshotIdSchema, "46c2eef5-a205-4526-8640-dc3ea84d88b4"),
  capturedAt: decode(CapturedAtSchema, "2026-08-12T00:00:00.000Z"),
  capture: decode(ArchiveCaptureSchema, {
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
  }),
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
const commitInput = deepFreeze({
  snapshot,
  event: createArticleArchived(snapshot),
  context,
})
const outboxMessageId = decode(
  MessageIdSchema,
  "8fb12955-2175-4675-be63-e42227d5ed19"
)
const jsonInterop = deepFreeze({
  parse: parseJsonUnsafe,
  stringify: stringifyJsonUnsafe,
})

describe("SQLite archive store", () => {
  it("atomically saves a snapshot and a correlated ArticleArchived outbox message", async () => {
    const database = openTestDatabase()
    try {
      const store = await Effect.runPromise(
        createArchiveStore(database.db, () => outboxMessageId, jsonInterop)
      )
      const result = await Effect.runPromise(store.commit(commitInput))
      const lookup = await Effect.runPromise(
        store.lookup(snapshot.archiveRequestId)
      )
      const limit = await Effect.runPromise(parseOutboxLimit(10))
      const pending = await Effect.runPromise(store.listPending(limit))
      const publishedEvent = await Effect.runPromise(
        parseArticleArchived(pending[0]?.envelope.payload)
      )

      expect(result).toEqual({ _tag: "Committed" })
      expect(lookup).toEqual({ _tag: "Archived", snapshot })
      expect(pending).toHaveLength(1)
      expect(publishedEvent).toEqual(commitInput.event)
      expect(pending[0]).toMatchObject({
        messageId: outboxMessageId,
        subject: "content.article-archived.v1",
        envelope: {
          messageId: outboxMessageId,
          correlationId: context.correlationId,
          causationId: context.messageId,
          traceparent: context.traceparent,
          actor: context.actor,
          producer: "content-knowledge",
          payload: commitInput.event,
        },
      })
      expect(Object.isFrozen(pending)).toBe(true)
      expect(Object.isFrozen(pending[0]?.envelope)).toBe(true)
    } finally {
      database.close()
    }
  })

  it("rolls the snapshot back when inserting its outbox record fails", async () => {
    const database = openTestDatabase()
    try {
      const store = await Effect.runPromise(
        createArchiveStore(database.db, () => outboxMessageId, jsonInterop)
      )
      database.execSql(`
        CREATE TRIGGER reject_content_outbox
        BEFORE INSERT ON content_outbox
        BEGIN
          SELECT RAISE(ABORT, 'forced outbox failure');
        END;
      `)

      const exit = await Effect.runPromiseExit(store.commit(commitInput))
      const lookup = await Effect.runPromise(
        store.lookup(snapshot.archiveRequestId)
      )

      expect(exit._tag).toBe("Failure")
      expect(lookup).toEqual({ _tag: "NotArchived" })
    } finally {
      database.close()
    }
  })

  it("returns the canonical snapshot and creates no second event on request retry", async () => {
    const database = openTestDatabase()
    try {
      const newMessageId = vi.fn(() => outboxMessageId)
      const store = await Effect.runPromise(
        createArchiveStore(database.db, newMessageId, jsonInterop)
      )
      await Effect.runPromise(store.commit(commitInput))

      const retried = await Effect.runPromise(store.commit(commitInput))
      const limit = await Effect.runPromise(parseOutboxLimit(10))
      const pending = await Effect.runPromise(store.listPending(limit))

      expect(retried).toEqual({ _tag: "AlreadyCommitted", snapshot })
      expect(pending).toHaveLength(1)
      expect(newMessageId).toHaveBeenCalledOnce()
    } finally {
      database.close()
    }
  })
})
