import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  parseArticleListQuery,
  parseArticleStatePatch,
  readOwnerArticleMarkdown,
  readOwnerSnapshotMarkdown,
  type ArticleListPage,
} from "../application/article-library.js"
import {
  ArchiveCaptureSchema,
  ArchiveCommandSchema,
  CapturedAtSchema,
  SnapshotIdSchema,
  createArticleSnapshot,
} from "../domain/article.js"
import { encodeArticleCursor } from "../domain/article-library.js"
import {
  CreatedAtSchema,
  FeedIdSchema,
  FeedUrlSchema,
  OwnerIdSchema,
  SubscriptionIdSchema,
} from "../domain/subscription.js"
import { stringifyJsonUnsafe } from "../infrastructure/unsafe/json.js"
import { openTestDatabase, type TestDatabase } from "./persistence/testing.js"
import { createArchiveStore } from "./persistence/archive/repository.js"
import { createArticleCatalog } from "./persistence/article-catalog/repository.js"
import { createArticleLibrary } from "./persistence/article-library/repository.js"
import { createArticleSearchIndexRepository } from "./persistence/article-search-index/repository.js"
import { createSubscriptionRepository } from "./persistence/subscription/repository.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)
const databases: TestDatabase[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

const ids = {
  ownerA: decode(OwnerIdSchema, "owner-a"),
  ownerB: decode(OwnerIdSchema, "owner-b"),
  feedA: decode(FeedIdSchema, "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"),
  feedB: decode(FeedIdSchema, "c7f32a8b-5358-4f4b-837b-b8b21965e65a"),
  articleA: "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never,
  articleB: "04b51d15-f488-4076-b99a-3c98f1feab05" as never,
  articleC: "e057741b-8e37-4f74-9a4b-989a1575072d" as never,
}

const setup = async () => {
  const database = openTestDatabase()
  databases.push(database)
  const subscriptions = await Effect.runPromise(
    createSubscriptionRepository(database.db)
  )
  const catalog = await Effect.runPromise(createArticleCatalog(database.db))
  const archiveStore = await Effect.runPromise(
    createArchiveStore(database.db, {
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
        key: "articles/46c2eef5-a205-4526-8640-dc3ea84d88b4/replay/index.html",
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
      assets: [
        {
          _tag: "Asset",
          key: `articles/46c2eef5-a205-4526-8640-dc3ea84d88b4/assets/${"a".repeat(64)}.css`,
          sha256: "4".repeat(64),
          mediaType: "text/css",
          byteLength: 12,
        },
      ],
    }),
  })
  await Effect.runPromise(
    archiveStore.commit({
      snapshot,
    })
  )
  const articles = await Effect.runPromise(createArticleLibrary(database.db))
  return { articles, archiveStore, catalog, database, snapshot, subscriptions }
}

const query = (overrides: Record<string, unknown> = {}) =>
  Effect.runPromise(
    parseArticleListQuery({
      limit: 50,
      state: "All",
      includeHidden: false,
      feedIds: [],
      order: "Newest",
      ...overrides,
    })
  )
const capturedAt = (value: string) => decode(CapturedAtSchema, value)

describe("SQLite article library", () => {
  it("authorizes exact replay objects by durable owner access after unsubscribe", async () => {
    const { articles, snapshot, subscriptions } = await setup()
    await Effect.runPromise(
      subscriptions.remove(
        ids.ownerA,
        decode(SubscriptionIdSchema, "9aa2225d-07e7-4af4-a8e6-e4788f801a91")
      )
    )

    await expect(
      Effect.runPromise(
        articles.findReplayObject(ids.ownerA, snapshot.snapshotId, {
          kind: "Replay",
        })
      )
    ).resolves.toMatchObject({
      _tag: "Found",
      object: { mediaType: "text/html", byteLength: 10 },
    })
    await expect(
      Effect.runPromise(
        articles.findReplayObject(ids.ownerA, snapshot.snapshotId, {
          kind: "Asset",
          assetName: `${"a".repeat(64)}.css`,
        })
      )
    ).resolves.toMatchObject({
      _tag: "Found",
      object: { mediaType: "text/css", byteLength: 12 },
    })
    await expect(
      Effect.runPromise(
        articles.findReplayObject(ids.ownerB, snapshot.snapshotId, {
          kind: "Replay",
        })
      )
    ).resolves.toEqual({ _tag: "NotFound" })
    await expect(
      Effect.runPromise(
        articles.findReplayObject(ids.ownerA, snapshot.snapshotId, {
          kind: "Asset",
          assetName: `${"b".repeat(64)}.png`,
        })
      )
    ).resolves.toEqual({ _tag: "NotFound" })
  })

  it("grants shared-feed items while a subscriber pauses and resumes", async () => {
    const { articles, catalog, database, subscriptions } = await setup()
    await Effect.runPromise(
      subscriptions.setEnabled(
        ids.ownerA,
        decode(SubscriptionIdSchema, "9aa2225d-07e7-4af4-a8e6-e4788f801a91"),
        false
      )
    )
    await Effect.runPromise(
      subscriptions.add({
        subscriptionId: decode(
          SubscriptionIdSchema,
          "89278c92-78bf-4913-aa6f-27e7a2847154"
        ),
        feedId: ids.feedA,
        ownerId: ids.ownerB,
        feedUrl: decode(FeedUrlSchema, "https://feeds.example.com/a.xml"),
        createdAt: decode(CreatedAtSchema, "2026-08-13T02:00:00.000Z"),
      })
    )
    await Effect.runPromise(
      catalog.upsert({
        articleId: ids.articleC,
        feedId: ids.feedA,
        externalId: "entry-c",
        sourceUrl: "https://news.example.com/c" as never,
        title: "Shared feed article" as never,
        discoveredAt: "2026-08-13T02:01:00.000Z",
      })
    )
    await Effect.runPromise(
      subscriptions.setEnabled(
        ids.ownerA,
        decode(SubscriptionIdSchema, "9aa2225d-07e7-4af4-a8e6-e4788f801a91"),
        true
      )
    )

    await expect(
      Effect.runPromise(articles.find(ids.ownerA, ids.articleC))
    ).resolves.toMatchObject({ _tag: "Found" })
    expect(
      database.getSql(
        `SELECT count(*) AS count FROM article_owner_access
         WHERE article_id = '${ids.articleC}'`
      )
    ).toEqual({ count: 2 })
  })

  it("keeps acquired articles readable after unsubscribe and re-subscribe", async () => {
    const { articles, catalog, database, subscriptions } = await setup()
    await Effect.runPromise(
      articles.patch(
        ids.ownerA,
        ids.articleA,
        await Effect.runPromise(parseArticleStatePatch({ saved: true })),
        capturedAt("2026-08-13T01:04:00.000Z")
      )
    )

    await expect(
      Effect.runPromise(
        subscriptions.remove(
          ids.ownerA,
          decode(SubscriptionIdSchema, "9aa2225d-07e7-4af4-a8e6-e4788f801a91")
        )
      )
    ).resolves.toEqual({ _tag: "Deleted" })

    await expect(
      Effect.runPromise(
        articles.list(ids.ownerA, await query({ state: "Saved" }))
      )
    ).resolves.toMatchObject({ items: [{ articleId: ids.articleA }] })
    await expect(
      Effect.runPromise(articles.find(ids.ownerA, ids.articleA))
    ).resolves.toMatchObject({
      _tag: "Found",
      article: { articleId: ids.articleA },
    })
    await expect(
      Effect.runPromise(articles.find(ids.ownerB, ids.articleA))
    ).resolves.toEqual({ _tag: "NotFound" })
    await expect(
      Effect.runPromise(articles.findMarkdown(ids.ownerA, ids.articleA))
    ).resolves.toEqual({ _tag: "Found", key: "articles/a/article.md" })
    await expect(
      Effect.runPromise(catalog.findSelected(ids.ownerA, [ids.articleA]))
    ).resolves.toHaveLength(1)
    await expect(
      Effect.runPromise(catalog.findAutomatic(ids.ownerA, 10))
    ).resolves.toEqual([])

    await Effect.runPromise(
      subscriptions.add({
        subscriptionId: decode(
          SubscriptionIdSchema,
          "5ac55f2e-ff0b-475c-866a-f2cff48c101d"
        ),
        feedId: ids.feedA,
        ownerId: ids.ownerA,
        feedUrl: decode(FeedUrlSchema, "https://feeds.example.com/a.xml"),
        createdAt: decode(CreatedAtSchema, "2026-08-13T02:00:00.000Z"),
      })
    )
    const afterResubscribe = await Effect.runPromise(
      articles.list(ids.ownerA, await query())
    )
    expect(afterResubscribe.items).toHaveLength(1)
    expect(afterResubscribe.items[0]).toMatchObject({ articleId: ids.articleA })
    expect(
      database.getSql(
        "SELECT count(*) AS count FROM article_owner_access WHERE owner_id = 'owner-a'"
      )
    ).toEqual({ count: 1 })
  })

  it("lists and reads only owner-scoped articles with strict archive metadata", async () => {
    const { articles, snapshot } = await setup()
    const found = await Effect.runPromise(
      articles.list(ids.ownerA, await query())
    )

    expect(found).toEqual({
      items: [
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
      ],
      nextCursor: null,
    })
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

  it("keeps archived title and URL aligned with the immutable snapshot", async () => {
    const { articles, catalog } = await setup()
    await Effect.runPromise(
      catalog.upsert({
        articleId: ids.articleA,
        feedId: ids.feedA,
        externalId: "entry-a",
        sourceUrl: "https://news.example.com/a-updated" as never,
        title: "Updated feed title" as never,
        publishedAt: "2026-08-13T00:00:00.000Z",
        discoveredAt: "2026-08-13T02:00:00.000Z",
      })
    )

    const found = await Effect.runPromise(
      articles.list(ids.ownerA, await query())
    )

    expect(found.items[0]).toMatchObject({
      title: "Owner A article",
      sourceUrl: "https://news.example.com/a",
    })
    const bySnapshotTitle = await Effect.runPromise(
      articles.list(ids.ownerA, await query({ q: "Owner A article" }))
    )
    expect(bySnapshotTitle.items).toHaveLength(1)
    const byMutableFeedTitle = await Effect.runPromise(
      articles.list(ids.ownerA, await query({ q: "Updated feed title" }))
    )
    expect(byMutableFeedTitle.items).toEqual([])
  })

  it("reads v1 metadata and Markdown after v2 becomes latest, bound to owner and article", async () => {
    const { articles, archiveStore, snapshot: v1 } = await setup()
    const v2Id = decode(
      SnapshotIdSchema,
      "56c2eef5-a205-4526-8640-dc3ea84d88b4"
    )
    const v2 = createArticleSnapshot({
      command: decode(ArchiveCommandSchema, {
        archiveRequestId: "27b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
        articleId: ids.articleA,
        sourceUrl: "https://news.example.com/a-v2",
        title: "Owner A article v2",
      }),
      snapshotId: v2Id,
      capturedAt: decode(CapturedAtSchema, "2026-08-13T02:03:00.000Z"),
      capture: decode(ArchiveCaptureSchema, {
        rawResponse: {
          _tag: "RawResponse",
          key: `articles/${v2Id}/raw/response.html`,
          sha256: "5".repeat(64),
          mediaType: "text/html",
          byteLength: 20,
        },
        replay: {
          _tag: "Replay",
          key: `articles/${v2Id}/replay/index.html`,
          sha256: "6".repeat(64),
          mediaType: "text/html",
          byteLength: 20,
        },
        markdown: {
          _tag: "Markdown",
          key: `articles/${v2Id}/markdown/article.md`,
          sha256: "7".repeat(64),
          mediaType: "text/markdown",
          byteLength: 20,
        },
        assets: [],
      }),
    })
    await Effect.runPromise(archiveStore.commit({ snapshot: v2 }))

    await expect(
      Effect.runPromise(
        articles.findSnapshot(ids.ownerA, ids.articleA, v1.snapshotId)
      )
    ).resolves.toMatchObject({
      _tag: "Found",
      article: {
        title: "Owner A article",
        sourceUrl: "https://news.example.com/a",
        snapshotId: v1.snapshotId,
      },
    })
    await expect(
      Effect.runPromise(
        articles.findSnapshot(ids.ownerB, ids.articleA, v1.snapshotId)
      )
    ).resolves.toEqual({ _tag: "NotFound" })
    await expect(
      Effect.runPromise(
        articles.findSnapshot(ids.ownerA, ids.articleB, v1.snapshotId)
      )
    ).resolves.toEqual({ _tag: "NotFound" })

    const read = vi.fn((key: string) => Effect.succeed(`# ${key}`))
    await expect(
      Effect.runPromise(
        readOwnerSnapshotMarkdown({ articles, objects: { read } })(
          ids.ownerA,
          ids.articleA,
          v1.snapshotId
        )
      )
    ).resolves.toEqual({ _tag: "Found", markdown: "# articles/a/article.md" })
    expect(read).toHaveBeenCalledWith("articles/a/article.md")
  })

  it("finds an article by an owner-scoped tag name", async () => {
    const { articles, database } = await setup()
    const tagId = "ce2690a0-3d85-4ac7-a731-1a0d087c0584"
    database.execSql(`
      INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at, enabled)
      VALUES ('1c625b13-a15f-4834-b00b-9b44b28bcd18', 'owner-b', '${ids.feedA}', '2026-08-13T02:00:00.000Z', 1);
      INSERT INTO content_tags(tag_id, owner_id, name, created_at)
      VALUES ('${tagId}', 'owner-a', 'observability', '2026-08-13T02:00:00.000Z');
      INSERT INTO content_article_tags(owner_id, article_id, tag_id, source, confidence, created_at)
      VALUES ('owner-a', '${ids.articleA}', '${tagId}', 'Manual', NULL, '2026-08-13T02:00:00.000Z');
    `)

    const found = await Effect.runPromise(
      articles.list(ids.ownerA, await query({ q: "observability" }))
    )

    expect(found.items.map((item) => item.articleId)).toEqual([ids.articleA])
    const otherOwner = await Effect.runPromise(
      articles.list(ids.ownerB, await query({ q: "observability" }))
    )
    expect(otherOwner.items).toEqual([])
  })

  it.each([
    ["Japanese substring", "永続化された日本語全文検索", "日本語全文"],
    ["short Japanese substring", "永続化された日本語全文検索", "日本"],
    ["whitespace phrase", "alpha  beta with spaces", "alpha  beta"],
    ["FTS quote", 'literal body with a "quoted" value', 'a "quoted"'],
    ["FTS operators", "literal OR * NEAR token", "OR * NEAR"],
  ])(
    "finds body-only text through the persisted index: %s",
    async (_case, body, search) => {
      const { articles, database, snapshot } = await setup()
      const searchIndex = createArticleSearchIndexRepository(database.db)
      const pending = (
        await Effect.runPromise(searchIndex.listPending(10))
      ).find((entry) => entry.snapshotId === snapshot.snapshotId)
      expect(pending).toBeDefined()
      await Effect.runPromise(searchIndex.index({ pending: pending!, body }))

      const found = await Effect.runPromise(
        articles.list(ids.ownerA, await query({ q: search }))
      )

      expect(found.items.map((item) => item.articleId)).toEqual([ids.articleA])
      expect(
        await Effect.runPromise(
          articles.list(ids.ownerB, await query({ q: search }))
        )
      ).toEqual({ items: [], nextCursor: null })
    }
  )

  it("searches indexed bodies beyond the first page and only in the latest snapshot", async () => {
    const { articles, archiveStore, catalog, database, snapshot } =
      await setup()
    await Effect.runPromise(
      catalog.upsert({
        articleId: ids.articleC,
        feedId: ids.feedA,
        externalId: "entry-c",
        sourceUrl: "https://news.example.com/c" as never,
        title: "Newest unrelated article" as never,
        publishedAt: "2026-08-14T00:00:00.000Z",
        discoveredAt: "2026-08-14T01:01:00.000Z",
      })
    )
    const latest = createArticleSnapshot({
      command: decode(ArchiveCommandSchema, {
        archiveRequestId: "37b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
        articleId: ids.articleA,
        sourceUrl: "https://news.example.com/a-latest",
        title: "Latest title",
      }),
      snapshotId: decode(
        SnapshotIdSchema,
        "66c2eef5-a205-4526-8640-dc3ea84d88b4"
      ),
      capturedAt: decode(CapturedAtSchema, "2026-08-14T01:03:00.000Z"),
      capture: snapshot.capture,
    })
    await Effect.runPromise(archiveStore.commit({ snapshot: latest }))
    const searchIndex = createArticleSearchIndexRepository(database.db)
    const pending = await Effect.runPromise(searchIndex.listPending(10))
    for (const [snapshotId, body] of [
      [snapshot.snapshotId, "superseded-only-needle"],
      [latest.snapshotId, "latest-body-needle"],
    ] as const) {
      const work = pending.find((entry) => entry.snapshotId === snapshotId)
      expect(work).toBeDefined()
      await Effect.runPromise(searchIndex.index({ pending: work!, body }))
    }

    const firstPage = await Effect.runPromise(
      articles.list(ids.ownerA, await query({ limit: 1 }))
    )
    expect(firstPage.items.map((item) => item.articleId)).toEqual([
      ids.articleC,
    ])
    expect(firstPage.nextCursor).not.toBeNull()
    expect(
      await Effect.runPromise(
        articles.list(ids.ownerA, await query({ q: "latest-body" }))
      )
    ).toEqual({
      items: [expect.objectContaining({ articleId: ids.articleA })],
      nextCursor: null,
    })
    expect(
      await Effect.runPromise(
        articles.list(ids.ownerA, await query({ q: "superseded-only" }))
      )
    ).toEqual({ items: [], nextCursor: null })
  })

  it("uses the latest snapshot once for automatic and selected generation", async () => {
    const { archiveStore, catalog } = await setup()
    const command = decode(ArchiveCommandSchema, {
      archiveRequestId: "27b7d763-e0f9-42c5-9cc7-8cdacc8d5b93",
      articleId: ids.articleA,
      sourceUrl: "https://news.example.com/a-latest",
      title: "Latest archived article",
    })
    const latest = createArticleSnapshot({
      command,
      snapshotId: decode(
        SnapshotIdSchema,
        "56c2eef5-a205-4526-8640-dc3ea84d88b4"
      ),
      capturedAt: decode(CapturedAtSchema, "2026-08-13T02:03:00.000Z"),
      capture: decode(ArchiveCaptureSchema, {
        rawResponse: {
          _tag: "RawResponse",
          key: "articles/a/latest.raw.html",
          sha256: "4".repeat(64),
          mediaType: "text/html",
          byteLength: 20,
        },
        replay: {
          _tag: "Replay",
          key: "articles/a/latest.replay.html",
          sha256: "5".repeat(64),
          mediaType: "text/html",
          byteLength: 20,
        },
        markdown: {
          _tag: "Markdown",
          key: "articles/a/latest.md",
          sha256: "6".repeat(64),
          mediaType: "text/markdown",
          byteLength: 20,
        },
        assets: [],
      }),
    })
    await Effect.runPromise(archiveStore.commit({ snapshot: latest }))

    const [automatic, selected, candidates] = await Effect.runPromise(
      Effect.all([
        catalog.findAutomatic(ids.ownerA, 20),
        catalog.findSelected(ids.ownerA, [ids.articleA]),
        catalog.listGenerationCandidates(ids.ownerA, 20, []),
      ])
    )

    expect(automatic).toEqual([
      expect.objectContaining({
        articleId: ids.articleA,
        snapshotId: latest.snapshotId,
        markdownKey: "articles/a/latest.md",
      }),
    ])
    expect(selected).toEqual(automatic)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.articleId).toBe(ids.articleA)
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
    ).toEqual({ items: [], nextCursor: null })
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
      feeds: [
        {
          feedId: ids.feedA,
          feedUrl: "https://feeds.example.com/a.xml",
          count: 1,
        },
      ],
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

/** 同一sortKeyを含む並びを跨いでも、重複・欠落なく全件を走査できることを確かめる。 */
describe("SQLite article library keyset pagination", () => {
  const paged = async (
    articles: Awaited<ReturnType<typeof setup>>["articles"],
    order: "Newest" | "Oldest"
  ) => {
    const seen: string[] = []
    const pages: number[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 20; guard += 1) {
      const page: ArticleListPage = await Effect.runPromise(
        articles.list(
          ids.ownerA,
          await query({
            limit: 2,
            order,
            ...(cursor === null ? {} : { cursor }),
          })
        )
      )
      pages.push(page.items.length)
      seen.push(...page.items.map((item) => item.articleId as string))
      if (page.nextCursor === null) return { seen, pages }
      cursor = page.nextCursor
    }
    throw new Error("cursor did not terminate")
  }

  it("walks every article exactly once and stops without an extra empty page", async () => {
    const { articles, catalog } = await setup()
    // articleA は 2026-08-13T00:00:00.000Z 公開。以降は同一公開時刻を2件含める。
    const extras = [
      {
        id: "1e2b1d0f-2b2a-4a1a-9f0a-000000000001",
        publishedAt: "2026-08-12T00:00:00.000Z",
      },
      {
        id: "1e2b1d0f-2b2a-4a1a-9f0a-000000000002",
        publishedAt: "2026-08-12T00:00:00.000Z",
      },
      {
        id: "1e2b1d0f-2b2a-4a1a-9f0a-000000000003",
        publishedAt: "2026-08-11T00:00:00.000Z",
      },
    ] as const
    for (const [index, extra] of extras.entries()) {
      await Effect.runPromise(
        catalog.upsert({
          articleId: extra.id as never,
          feedId: ids.feedA,
          externalId: `extra-${index}`,
          sourceUrl: `https://news.example.com/extra-${index}` as never,
          title: `Extra ${index}` as never,
          publishedAt: extra.publishedAt,
          discoveredAt: "2026-08-13T01:01:00.000Z",
        })
      )
    }

    const newest = await paged(articles, "Newest")
    expect(newest.pages).toEqual([2, 2])
    expect(newest.seen).toHaveLength(4)
    expect(new Set(newest.seen).size).toBe(4)
    expect(newest.seen[0]).toBe(ids.articleA)
    expect(newest.seen.at(-1)).toBe(extras[2].id)

    const oldest = await paged(articles, "Oldest")
    expect(oldest.seen).toEqual([...newest.seen].reverse())
  })

  it("reports no further page when the result exactly fills the limit", async () => {
    const { articles } = await setup()
    const page = await Effect.runPromise(
      articles.list(ids.ownerA, await query({ limit: 1 }))
    )
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBeNull()
  })

  it("resolves a cursor against the caller's own rows, never the issuer's", async () => {
    const { articles } = await setup()
    // ownerAの記事Aの位置。ownerBが提示しても、返るのはownerB自身の記事だけ。
    const cursor = encodeArticleCursor({
      sortKey: "2026-08-13T00:00:00.000Z" as never,
      articleId: ids.articleA,
    })
    expect(
      await Effect.runPromise(
        articles.list(
          ids.ownerB,
          await query({ limit: 10, order: "Oldest", cursor })
        )
      )
    ).toEqual({
      items: [expect.objectContaining({ articleId: ids.articleB })],
      nextCursor: null,
    })
  })
})
