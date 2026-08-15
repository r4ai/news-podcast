import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  ArchiveCaptureSchema,
  ArchiveCommandSchema,
  CapturedAtSchema,
  SnapshotIdSchema,
  createArticleSnapshot,
} from "../domain/article.js"
import {
  CreatedAtSchema,
  FeedIdSchema,
  FeedUrlSchema,
  OwnerIdSchema,
  SubscriptionIdSchema,
} from "../domain/subscription.js"
import { createArchiveStore } from "./persistence/archive/repository.js"
import { createArticleCatalog } from "./persistence/article-catalog/repository.js"
import { createSubscriptionRepository } from "./persistence/subscription/repository.js"
import { openTestDatabase } from "./persistence/testing.js"
import {
  parseJsonUnsafe,
  stringifyJsonUnsafe,
} from "../infrastructure/unsafe/json.js"
import { materializeArticles } from "../application/materialize-articles.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)
const ownerA = decode(OwnerIdSchema, "owner-a")
const ownerB = decode(OwnerIdSchema, "owner-b")
const feedId = decode(FeedIdSchema, "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd")
const articleId = "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never

describe("article materialization", () => {
  it("returns Markdown only for archived articles owned through a subscription", async () => {
    const database = openTestDatabase()
    try {
      const subscriptions = await Effect.runPromise(
        createSubscriptionRepository(database.db)
      )
      const catalog = await Effect.runPromise(
        createArticleCatalog(database.db, {
          parse: parseJsonUnsafe,
        })
      )
      const archiveStore = await Effect.runPromise(
        createArchiveStore(database.db, {
          parse: parseJsonUnsafe,
          stringify: stringifyJsonUnsafe,
        })
      )
      await Effect.runPromise(
        subscriptions.add({
          subscriptionId: decode(
            SubscriptionIdSchema,
            "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
          ),
          feedId,
          ownerId: ownerA,
          feedUrl: decode(FeedUrlSchema, "https://feeds.example.com/news.xml"),
          createdAt: decode(CreatedAtSchema, "2026-08-13T01:00:00.000Z"),
        })
      )
      await Effect.runPromise(
        catalog.upsert({
          articleId,
          feedId,
          externalId: "entry-1",
          sourceUrl: "https://news.example.com/stable" as never,
          title: "Stable article" as never,
          publishedAt: "2026-08-13T00:00:00.000Z",
          discoveredAt: "2026-08-13T01:01:00.000Z",
        })
      )
      const command = decode(ArchiveCommandSchema, {
        archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
        articleId,
        sourceUrl: "https://news.example.com/stable",
        title: "Stable article",
      })
      const snapshot = createArticleSnapshot({
        command,
        snapshotId: decode(
          SnapshotIdSchema,
          "46c2eef5-a205-4526-8640-dc3ea84d88b4"
        ),
        capturedAt: decode(CapturedAtSchema, "2026-08-13T01:02:00.000Z"),
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
      await Effect.runPromise(
        archiveStore.commit({
          snapshot,
        })
      )
      const read = vi.fn(() => Effect.succeed("# Stable\n\nArchived body"))
      const materialize = materializeArticles({ catalog, objects: { read } })

      const automatic = await Effect.runPromise(
        materialize({ ownerId: ownerA, selection: { _tag: "Automatic" } })
      )
      expect(automatic).toEqual({
        _tag: "Materialized",
        articles: [
          {
            articleId,
            snapshotId: snapshot.snapshotId,
            title: "Stable article",
            url: "https://news.example.com/stable",
            markdown: "# Stable\n\nArchived body",
            publishedAt: "2026-08-13T00:00:00.000Z",
          },
        ],
      })
      expect(read).toHaveBeenCalledWith("articles/a/article.md")
      expect(
        await Effect.runPromise(
          materialize({
            ownerId: ownerB,
            selection: { _tag: "Selected", articleIds: [articleId] },
          })
        )
      ).toEqual({ _tag: "NotFound" })
    } finally {
      database.close()
    }
  })

  it("does not return partial selected results or partial object reads", async () => {
    const catalog = {
      findAutomatic: vi.fn(),
      findSelected: vi.fn(() => Effect.succeed([])),
      upsert: vi.fn(),
    }
    const read = vi.fn()
    const result = await Effect.runPromise(
      materializeArticles({ catalog: catalog as never, objects: { read } })({
        ownerId: ownerA,
        selection: { _tag: "Selected", articleIds: [articleId] },
      })
    )
    expect(result).toEqual({ _tag: "NotFound" })
    expect(read).not.toHaveBeenCalled()
  })
})
