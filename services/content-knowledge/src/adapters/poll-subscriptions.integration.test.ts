import { createServer } from "node:http"

import { deepFreeze } from "@news-podcast/kernel"
import {
  ActorSchema,
  CorrelationIdSchema,
  MessageIdSchema,
  TraceparentSchema,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ArchiveCaptureSchema,
  CapturedAtSchema,
  SnapshotIdSchema,
} from "../domain/article.js"
import {
  CreatedAtSchema,
  FeedIdSchema,
  FeedUrlSchema,
  OwnerIdSchema,
  SubscriptionIdSchema,
} from "../domain/subscription.js"
import { createHttpRssFeedReader } from "./providers/rss/http-feed-reader.js"
import { createArchiveStore } from "./persistence/archive/repository.js"
import { createArticleCatalog } from "./persistence/article-catalog/repository.js"
import { createSubscriptionRepository } from "./persistence/subscription/repository.js"
import { openTestDatabase } from "./persistence/testing.js"
import {
  parseJsonUnsafe,
  stringifyJsonUnsafe,
} from "../infrastructure/unsafe/json.js"
import { archiveArticle } from "../application/archive-article.js"
import { pollSubscriptions } from "../application/poll-subscriptions.js"
import { deriveArticleIdentityUnsafe } from "../infrastructure/unsafe/identity.js"

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
const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)

describe("pollSubscriptions integration", () => {
  it("keeps retries idempotent but snapshots an updated same-GUID item", async () => {
    let version = "v1"
    const server = createServer((_request, response) =>
      response.end(`
      <rss><channel><item><guid>same-entry</guid><title>Item ${version}</title>
      <description>Body ${version}</description>
      <link>https://news.example.com/${version}</link></item></channel></rss>`)
    )
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string")
      throw new Error("missing address")

    const database = openTestDatabase()
    try {
      const subscriptions = await Effect.runPromise(
        createSubscriptionRepository(database.db)
      )
      const archiveStore = await Effect.runPromise(
        createArchiveStore(database.db, {
          parse: parseJsonUnsafe,
          stringify: stringifyJsonUnsafe,
        })
      )
      const catalog = await Effect.runPromise(
        createArticleCatalog(database.db, { parse: parseJsonUnsafe })
      )
      await Effect.runPromise(
        subscriptions.add({
          subscriptionId: decode(
            SubscriptionIdSchema,
            "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
          ),
          feedId: decode(FeedIdSchema, "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"),
          ownerId: decode(OwnerIdSchema, "owner-a"),
          feedUrl: decode(
            FeedUrlSchema,
            `http://127.0.0.1:${address.port}/feed.xml`
          ),
          createdAt: decode(CreatedAtSchema, "2026-08-13T01:00:00.000Z"),
        })
      )
      const capture = decode(ArchiveCaptureSchema, {
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
      })
      const captureArticle = vi.fn(() => Effect.succeed(capture))
      const snapshotIds = [
        decode(SnapshotIdSchema, "46c2eef5-a205-4526-8640-dc3ea84d88b4"),
        decode(SnapshotIdSchema, "56c2eef5-a205-4526-8640-dc3ea84d88b4"),
      ]
      const capturedAts = [
        decode(CapturedAtSchema, "2026-08-13T01:02:00.000Z"),
        decode(CapturedAtSchema, "2026-08-13T01:03:00.000Z"),
      ]
      let snapshotIndex = 0
      const archive = archiveArticle({
        ...archiveStore,
        capture: captureArticle,
        newSnapshotId: () => snapshotIds[snapshotIndex]!,
        now: () => capturedAts[snapshotIndex++]!,
      })
      const poll = pollSubscriptions({
        subscriptions,
        catalog,
        reader: createHttpRssFeedReader({
          timeoutMillis: 1_000,
          maximumBytes: 8_192,
        }),
        archive,
        deriveArticleIdentity: deriveArticleIdentityUnsafe,
        newContext: () =>
          deepFreeze({
            messageId: decode(
              MessageIdSchema,
              "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4"
            ),
            correlationId: decode(
              CorrelationIdSchema,
              "ea122752-73d0-4851-9664-7d3e63e76859"
            ),
            traceparent: decode(
              TraceparentSchema,
              "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
            ),
            actor: decode(ActorSchema, {
              _tag: "Service",
              service: "content-knowledge",
            }),
          }),
        now: () => "2026-08-13T01:01:00.000Z",
      })

      expect(await Effect.runPromise(poll())).toMatchObject({
        archived: 1,
        alreadyArchived: 0,
        failed: 0,
      })
      // Simulate a pre-fingerprint deployment: matching legacy metadata is
      // baselined without a one-time recapture of every stored article.
      database.runSql("UPDATE feed_items SET capture_fingerprint = NULL")
      expect(await Effect.runPromise(poll())).toMatchObject({
        archived: 0,
        alreadyArchived: 1,
        failed: 0,
      })
      expect(
        database.getSql(
          "SELECT capture_fingerprint AS fingerprint FROM feed_items"
        )
      ).toEqual({ fingerprint: expect.stringMatching(/^[\da-f]{64}$/) })
      version = "v2"
      expect(await Effect.runPromise(poll())).toMatchObject({
        archived: 1,
        alreadyArchived: 0,
        failed: 0,
      })
      expect(await Effect.runPromise(poll())).toMatchObject({
        archived: 0,
        alreadyArchived: 1,
        failed: 0,
      })
      expect(captureArticle).toHaveBeenCalledTimes(2)
      expect(
        database.getSql("SELECT COUNT(*) AS count FROM article_snapshots")
      ).toEqual({ count: 2 })
      expect(
        await Effect.runPromise(
          catalog.findAutomatic(decode(OwnerIdSchema, "owner-a"), 10)
        )
      ).toEqual([
        expect.objectContaining({
          snapshotId: snapshotIds[1],
          title: "Item v2",
          sourceUrl: "https://news.example.com/v2",
        }),
      ])
    } finally {
      database.close()
    }
  })

  it("isolates one feed failure and reports only its redacted reason", async () => {
    const subscriptions = {
      listFeedsForPolling: () =>
        Effect.succeed([
          {
            feedId: "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd",
            feedUrl: "https://one.example/feed",
          },
          {
            feedId: "02f2949b-102b-4121-8868-347cdf01e930",
            feedUrl: "https://two.example/feed",
          },
        ] as never),
    }
    const read = vi
      .fn()
      .mockReturnValueOnce(
        Effect.fail({ _tag: "FeedFetchFailed", reason: "Timeout" })
      )
      .mockReturnValueOnce(Effect.succeed([]))
    const result = await Effect.runPromise(
      pollSubscriptions({
        subscriptions: subscriptions as never,
        reader: { read },
        archive: vi.fn(),
        deriveArticleIdentity: vi.fn(),
        newContext: vi.fn(),
        now: vi.fn(),
      })()
    )

    expect(result).toEqual({
      feeds: 2,
      discovered: 0,
      archived: 0,
      alreadyArchived: 0,
      failed: 1,
      failures: [{ _tag: "FeedPollFailed", scope: "Feed", reason: "Timeout" }],
    })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("classifies an archive failure as an isolated item failure", async () => {
    const markCaptured = vi.fn(() => Effect.void)
    const result = await Effect.runPromise(
      pollSubscriptions({
        subscriptions: {
          listFeedsForPolling: () =>
            Effect.succeed([
              { feedId: "feed-1", feedUrl: "https://feed.test" },
            ] as never),
        },
        catalog: {
          upsert: () => Effect.succeed({ _tag: "CaptureRequired" as const }),
          markCaptured,
        },
        reader: {
          read: () =>
            Effect.succeed([
              {
                externalId: "item-1",
                url: "https://news.example.com/item-1",
                title: "Unavailable article",
              },
            ] as never),
        },
        archive: () =>
          Effect.fail({ _tag: "CaptureFailed", reason: "Unavailable" }),
        deriveArticleIdentity: () =>
          deepFreeze({
            archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93" as never,
            articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never,
          }),
        newContext: () =>
          deepFreeze({
            messageId: "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4" as never,
            correlationId: "ea122752-73d0-4851-9664-7d3e63e76859" as never,
            traceparent:
              "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" as never,
            actor: {
              _tag: "Service",
              service: "content-knowledge",
            } as never,
          }),
        now: () => "2026-08-13T01:01:00.000Z",
      })()
    )

    expect(result).toMatchObject({
      discovered: 1,
      archived: 0,
      failed: 1,
      failures: [
        { _tag: "FeedPollFailed", scope: "Item", reason: "ArchiveFailed" },
      ],
    })
    expect(markCaptured).not.toHaveBeenCalled()
  })

  it("classifies catalog persistence failure as a feed failure", async () => {
    let archiveExecuted = false
    const archive = vi.fn(() =>
      Effect.sync(() => {
        archiveExecuted = true
        return { _tag: "Archived" } as never
      })
    )
    const result = await Effect.runPromise(
      pollSubscriptions({
        subscriptions: {
          listFeedsForPolling: () =>
            Effect.succeed([
              { feedId: "feed-1", feedUrl: "https://feed.test" },
            ] as never),
        },
        catalog: {
          upsert: () =>
            Effect.fail({
              _tag: "ArticleCatalogFailed",
              operation: "Upsert",
              reason: "Unavailable",
            }),
        },
        reader: {
          read: () =>
            Effect.succeed([
              {
                externalId: "item-1",
                url: "https://news.example.com/item-1",
                title: "Catalog write failure",
              },
            ] as never),
        },
        archive,
        deriveArticleIdentity: () =>
          deepFreeze({
            archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93" as never,
            articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never,
          }),
        newContext: vi.fn(),
        now: () => "2026-08-13T01:01:00.000Z",
      })()
    )

    expect(result).toMatchObject({
      discovered: 1,
      archived: 0,
      failed: 1,
      failures: [
        { _tag: "FeedPollFailed", scope: "Feed", reason: "CatalogFailed" },
      ],
    })
    expect(archiveExecuted).toBe(false)
  })
})
