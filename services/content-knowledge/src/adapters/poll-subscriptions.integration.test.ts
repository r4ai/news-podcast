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
import { createHttpRssFeedReader } from "./http-rss-feed-reader.js"
import { parseOutboxLimit } from "./outbox.js"
import { createSqliteArchiveStore } from "./sqlite-archive-store.js"
import { createSqliteSubscriptionRepository } from "./sqlite-subscription-repository.js"
import { openSqliteUnsafe } from "../infrastructure/unsafe/sqlite.js"
import {
  parseJsonUnsafe,
  stringifyJsonUnsafe,
} from "../infrastructure/unsafe/json.js"
import { archiveArticle } from "../application/archive-article.js"
import { pollSubscriptions } from "../application/poll-subscriptions.js"

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
  it("polls real RSS HTTP and archives duplicate items exactly once", async () => {
    const server = createServer((_request, response) =>
      response.end(`
      <rss><channel><item><guid>same-entry</guid><title>Stable item</title>
      <link>https://news.example.com/stable</link></item></channel></rss>`)
    )
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string")
      throw new Error("missing address")

    const database = openSqliteUnsafe(":memory:")
    try {
      const subscriptions = await Effect.runPromise(
        createSqliteSubscriptionRepository(database)
      )
      const archiveStore = await Effect.runPromise(
        createSqliteArchiveStore(
          database,
          () => decode(MessageIdSchema, "8fb12955-2175-4675-be63-e42227d5ed19"),
          { parse: parseJsonUnsafe, stringify: stringifyJsonUnsafe }
        )
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
      const archive = archiveArticle({
        ...archiveStore,
        capture: captureArticle,
        newSnapshotId: () =>
          decode(SnapshotIdSchema, "46c2eef5-a205-4526-8640-dc3ea84d88b4"),
        now: () => decode(CapturedAtSchema, "2026-08-13T01:02:00.000Z"),
      })
      const poll = pollSubscriptions({
        subscriptions,
        reader: createHttpRssFeedReader({
          timeoutMillis: 1_000,
          maximumBytes: 8_192,
        }),
        archive,
        deriveArticleIdentity: () =>
          deepFreeze({
            archiveRequestId: "17b7d763-e0f9-42c5-9cc7-8cdacc8d5b93" as never,
            articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d" as never,
          }),
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
      expect(await Effect.runPromise(poll())).toMatchObject({
        archived: 0,
        alreadyArchived: 1,
        failed: 0,
      })
      expect(captureArticle).toHaveBeenCalledOnce()
      const pending = await Effect.runPromise(
        archiveStore.listPending(await Effect.runPromise(parseOutboxLimit(10)))
      )
      expect(pending).toHaveLength(1)
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
      failures: [{ _tag: "FeedPollFailed", reason: "Timeout" }],
    })
    expect(read).toHaveBeenCalledTimes(2)
  })
})
