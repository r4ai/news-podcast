import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { SyncJobIdSchema } from "../domain/feed-sync.js"
import { FeedIdSchema, FeedUrlSchema } from "../domain/subscription.js"
import { openSqliteUnsafe } from "../infrastructure/unsafe/sqlite.js"
import { createSqliteFeedSyncQueue } from "./sqlite-feed-sync-queue.js"

const feedId = Schema.decodeUnknownSync(FeedIdSchema)(
  "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"
)
const feedUrl = Schema.decodeUnknownSync(FeedUrlSchema)(
  "https://feeds.example.com/news.xml"
)

describe("SQLite feed sync queue", () => {
  it("persists a queued job and makes it visible to the subscribed owner", async () => {
    const database = openSqliteUnsafe(":memory:")
    try {
      database.execute(`
        CREATE TABLE feed_catalog (
          feed_id TEXT PRIMARY KEY,
          feed_url TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE feed_subscriptions (
          subscription_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          feed_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1
        ) STRICT;
        INSERT INTO feed_catalog VALUES (
          '${feedId}', '${feedUrl}', '2026-08-13T01:00:00.000Z'
        );
        INSERT INTO feed_subscriptions VALUES (
          '9aa2225d-07e7-4af4-a8e6-e4788f801a91', 'owner-a',
          '${feedId}', '2026-08-13T01:00:00.000Z', 1
        );
      `)

      const queue = await Effect.runPromise(createSqliteFeedSyncQueue(database))
      const job = await Effect.runPromise(
        queue.enqueue(feedId, "2026-08-13T01:00:00.000Z")
      )

      expect(Schema.decodeUnknownSync(SyncJobIdSchema)(job.jobId)).toBe(
        job.jobId
      )
      expect(job).toMatchObject({
        feedId,
        feedUrl,
        status: "Queued",
        attempt: 0,
        discovered: 0,
        archived: 0,
        failed: 0,
      })
      await expect(
        Effect.runPromise(queue.listForOwner("owner-a" as never))
      ).resolves.toEqual([job])
    } finally {
      database.close()
    }
  })

  it("does not claim a job after its subscription is disabled", async () => {
    const database = openSqliteUnsafe(":memory:")
    try {
      database.execute(`
        CREATE TABLE feed_catalog (
          feed_id TEXT PRIMARY KEY,
          feed_url TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE feed_subscriptions (
          subscription_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          feed_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1
        ) STRICT;
        INSERT INTO feed_catalog VALUES (
          '${feedId}', '${feedUrl}', '2026-08-13T01:00:00.000Z'
        );
        INSERT INTO feed_subscriptions VALUES (
          '9aa2225d-07e7-4af4-a8e6-e4788f801a91', 'owner-a',
          '${feedId}', '2026-08-13T01:00:00.000Z', 1
        );
      `)

      const queue = await Effect.runPromise(createSqliteFeedSyncQueue(database))
      await Effect.runPromise(queue.enqueue(feedId, "2026-08-13T01:00:00.000Z"))
      database.run(
        "UPDATE feed_subscriptions SET enabled = 0 WHERE feed_id = ?",
        [feedId]
      )

      await expect(
        Effect.runPromise(
          queue.claim("2026-08-13T01:00:02.000Z", "2026-08-13T01:05:02.000Z")
        )
      ).resolves.toBeUndefined()
    } finally {
      database.close()
    }
  })

  it("retries failed syncs up to the durable attempt limit", async () => {
    const database = openSqliteUnsafe(":memory:")
    try {
      database.execute(`
        CREATE TABLE feed_catalog (
          feed_id TEXT PRIMARY KEY,
          feed_url TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE feed_subscriptions (
          subscription_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          feed_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1
        ) STRICT;
        INSERT INTO feed_catalog VALUES (
          '${feedId}', '${feedUrl}', '2026-08-13T01:00:00.000Z'
        );
        INSERT INTO feed_subscriptions VALUES (
          '9aa2225d-07e7-4af4-a8e6-e4788f801a91', 'owner-a',
          '${feedId}', '2026-08-13T01:00:00.000Z', 1
        );
      `)

      const queue = await Effect.runPromise(createSqliteFeedSyncQueue(database))
      let job = await Effect.runPromise(
        queue.enqueue(feedId, "2026-08-13T01:00:00.000Z")
      )
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const claimed = await Effect.runPromise(
          queue.claim(
            `2026-08-13T01:00:0${attempt}.000Z`,
            `2026-08-13T01:05:0${attempt}.000Z`
          )
        )
        expect(claimed?.attempt).toBe(attempt)
        job = await Effect.runPromise(
          queue.complete(
            claimed!.jobId,
            { discovered: 1, archived: 0, failed: 1, error: "HttpStatus" },
            `2026-08-13T01:00:1${attempt}.000Z`
          )
        )
        await Effect.runPromise(
          queue.enqueueForPolling(
            [{ feedId, feedUrl }],
            `2026-08-13T01:00:2${attempt}.000Z`
          )
        )
        if (attempt < 4) expect(job.status).toBe("Failed")
      }

      await expect(
        Effect.runPromise(
          queue.claim("2026-08-13T01:01:00.000Z", "2026-08-13T01:06:00.000Z")
        )
      ).resolves.toBeUndefined()
    } finally {
      database.close()
    }
  })
})
