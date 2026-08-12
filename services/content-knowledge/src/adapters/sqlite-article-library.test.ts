import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  parseArticleListQuery,
  parseArticleStatePatch,
  readOwnerArticleMarkdown,
} from "../application/article-library.js"
import {
  ArchiveCaptureSchema,
  ArchiveCommandSchema,
  CapturedAtSchema,
  SnapshotIdSchema,
  createArticleArchived,
  createArticleSnapshot,
} from "../domain/article.js"
import {
  CreatedAtSchema,
  FeedIdSchema,
  FeedUrlSchema,
  OwnerIdSchema,
  SubscriptionIdSchema,
} from "../domain/subscription.js"
import {
  parseJsonUnsafe,
  stringifyJsonUnsafe,
} from "../infrastructure/unsafe/json.js"
import { openSqliteUnsafe } from "../infrastructure/unsafe/sqlite.js"
import { createSqliteArchiveStore } from "./sqlite-archive-store.js"
import { createSqliteArticleCatalog } from "./sqlite-article-catalog.js"
import { createSqliteArticleLibrary } from "./sqlite-article-library.js"
import { createSqliteSubscriptionRepository } from "./sqlite-subscription-repository.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)
const databases: ReturnType<typeof openSqliteUnsafe>[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

const ids = {
  ownerA: decode(OwnerIdSchema, "owner-a"),
  ownerB: decode(OwnerIdSchema, "owner-b"),
  feedA: decode(FeedIdSchema, "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"),
  feedB: decode(FeedIdSchema, "c7f32a8b-5358-4f4b-837b-b8b21965e65a"),
  articleA: "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never,
  articleB: "04b51d15-f488-4076-b99a-3c98f1feab05" as never,
}

const setup = async () => {
  const database = openSqliteUnsafe(":memory:")
  databases.push(database)
  const subscriptions = await Effect.runPromise(
    createSqliteSubscriptionRepository(database)
  )
  const catalog = await Effect.runPromise(
    createSqliteArticleCatalog(database, { parse: parseJsonUnsafe })
  )
  const archiveStore = await Effect.runPromise(
    createSqliteArchiveStore(database, () => crypto.randomUUID() as never, {
      parse: parseJsonUnsafe,
      stringify: stringifyJsonUnsafe,
    })
  )
  for (const input of [
    {
      subscriptionId: decode(
        SubscriptionIdSchema,
        "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
      ),
      feedId: ids.feedA,
      ownerId: ids.ownerA,
      feedUrl: decode(FeedUrlSchema, "https://feeds.example.com/a.xml"),
    },
    {
      subscriptionId: decode(
        SubscriptionIdSchema,
        "33bd5f2a-7809-4275-90d9-89dc01da9c60"
      ),
      feedId: ids.feedB,
      ownerId: ids.ownerB,
      feedUrl: decode(FeedUrlSchema, "https://feeds.example.com/b.xml"),
    },
  ]) {
    await Effect.runPromise(
      subscriptions.add({
        ...input,
        createdAt: decode(CreatedAtSchema, "2026-08-13T01:00:00.000Z"),
      })
    )
  }
  await Effect.runPromise(
    catalog.upsert({
      articleId: ids.articleA,
      feedId: ids.feedA,
      externalId: "entry-a",
      sourceUrl: "https://news.example.com/a" as never,
      title: "Owner A article" as never,
      publishedAt: "2026-08-13T00:00:00.000Z",
      discoveredAt: "2026-08-13T01:01:00.000Z",
    })
  )
  await Effect.runPromise(
    catalog.upsert({
      articleId: ids.articleB,
      feedId: ids.feedB,
      externalId: "entry-b",
      sourceUrl: "https://news.example.com/b" as never,
      title: "Owner B article" as never,
      discoveredAt: "2026-08-13T01:02:00.000Z",
    })
  )

  const command = decode(ArchiveCommandSchema, {
    archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
    articleId: ids.articleA,
    sourceUrl: "https://news.example.com/a",
    title: "Owner A article",
  })
  const snapshot = createArticleSnapshot({
    command,
    snapshotId: decode(
      SnapshotIdSchema,
      "46c2eef5-a205-4526-8640-dc3ea84d88b4"
    ),
    capturedAt: decode(CapturedAtSchema, "2026-08-13T01:03:00.000Z"),
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
      event: createArticleArchived(snapshot),
      context: {
        messageId: crypto.randomUUID() as never,
        correlationId: crypto.randomUUID() as never,
        traceparent:
          "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" as never,
        actor: { _tag: "Service", service: "content-knowledge" as never },
      },
    })
  )
  const articles = await Effect.runPromise(createSqliteArticleLibrary(database))
  return { articles, catalog, snapshot }
}

const query = () =>
  Effect.runPromise(
    parseArticleListQuery({
      limit: 50,
      state: "All",
      includeHidden: false,
      feedIds: [],
      order: "Newest",
    })
  )
const capturedAt = (value: string) => decode(CapturedAtSchema, value)

describe("SQLite article library", () => {
  it("lists and reads only owner-scoped articles with strict archive metadata", async () => {
    const { articles, snapshot } = await setup()
    const found = await Effect.runPromise(
      articles.list(ids.ownerA, await query())
    )

    expect(found).toEqual([
      expect.objectContaining({
        articleId: ids.articleA,
        archiveStatus: "Succeeded",
        snapshotId: snapshot.snapshotId,
        state: {
          read: false,
          saved: false,
          readLater: false,
          hidden: false,
          hiddenAt: null,
        },
      }),
    ])
    expect(
      await Effect.runPromise(articles.find(ids.ownerB, ids.articleA))
    ).toEqual({ _tag: "NotFound" })

    const read = vi.fn(() => Effect.succeed("# archived"))
    expect(
      await Effect.runPromise(
        readOwnerArticleMarkdown({ articles, objects: { read } })(
          ids.ownerA,
          ids.articleA
        )
      )
    ).toEqual({ _tag: "Found", markdown: "# archived" })
    expect(read).toHaveBeenCalledWith("articles/a/article.md")
    expect(
      await Effect.runPromise(
        readOwnerArticleMarkdown({ articles, objects: { read } })(
          ids.ownerB,
          ids.articleA
        )
      )
    ).toEqual({ _tag: "NotFound" })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("patches hidden/read state per owner and excludes hidden generation candidates", async () => {
    const { articles, catalog } = await setup()
    const patch = await Effect.runPromise(
      parseArticleStatePatch({ hidden: true, read: true })
    )
    expect(
      await Effect.runPromise(
        articles.patch(
          ids.ownerB,
          ids.articleA,
          patch,
          capturedAt("2026-08-13T02:00:00.000Z")
        )
      )
    ).toEqual({ _tag: "NotFound" })
    const updated = await Effect.runPromise(
      articles.patch(
        ids.ownerA,
        ids.articleA,
        patch,
        capturedAt("2026-08-13T02:00:00.000Z")
      )
    )
    expect(updated).toEqual({
      _tag: "Found",
      article: expect.objectContaining({
        state: expect.objectContaining({
          read: true,
          hidden: true,
          hiddenAt: "2026-08-13T02:00:00.000Z",
        }),
      }),
    })
    expect(
      await Effect.runPromise(articles.list(ids.ownerA, await query()))
    ).toEqual([])
    expect(
      await Effect.runPromise(catalog.findAutomatic(ids.ownerA, 20))
    ).toEqual([])

    const stillHidden = await Effect.runPromise(
      articles.patch(
        ids.ownerA,
        ids.articleA,
        await Effect.runPromise(parseArticleStatePatch({ saved: true })),
        capturedAt("2026-08-13T02:30:00.000Z")
      )
    )
    expect(stillHidden).toEqual({
      _tag: "Found",
      article: expect.objectContaining({
        state: expect.objectContaining({
          hidden: true,
          hiddenAt: "2026-08-13T02:00:00.000Z",
        }),
      }),
    })

    const unhide = await Effect.runPromise(
      parseArticleStatePatch({ hidden: false })
    )
    const visible = await Effect.runPromise(
      articles.patch(
        ids.ownerA,
        ids.articleA,
        unhide,
        capturedAt("2026-08-13T03:00:00.000Z")
      )
    )
    expect(visible).toEqual({
      _tag: "Found",
      article: expect.objectContaining({
        state: expect.objectContaining({ hidden: false, hiddenAt: null }),
      }),
    })
  })

  it("bulk-updates only matching owner rows and returns useful facets", async () => {
    const { articles } = await setup()
    const patch = await Effect.runPromise(
      parseArticleStatePatch({ saved: true })
    )
    const base = await query()
    expect(
      await Effect.runPromise(
        articles.bulkPatch(
          ids.ownerA,
          {
            state: "All",
            includeHidden: false,
            feedIds: [],
          },
          patch,
          capturedAt("2026-08-13T02:00:00.000Z")
        )
      )
    ).toBe(1)
    expect(
      await Effect.runPromise(
        articles.facets(ids.ownerA, {
          includeHidden: base.includeHidden,
          feedIds: base.feedIds,
        })
      )
    ).toEqual({
      states: { all: 1, unread: 1, saved: 1, later: 0 },
      feeds: [{ feedId: ids.feedA, count: 1 }],
    })
    expect(
      await Effect.runPromise(articles.find(ids.ownerB, ids.articleB))
    ).toEqual({
      _tag: "Found",
      article: expect.objectContaining({
        state: expect.objectContaining({ saved: false }),
      }),
    })
    expect(
      await Effect.runPromise(
        articles.facets("owner-with-no-subscriptions" as never, {
          includeHidden: false,
          feedIds: [],
        })
      )
    ).toEqual({
      states: { all: 0, unread: 0, saved: 0, later: 0 },
      feeds: [],
    })
  })
})
