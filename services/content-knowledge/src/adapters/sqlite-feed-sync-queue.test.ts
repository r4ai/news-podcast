import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { SyncJobIdSchema } from "../domain/feed-sync.js"
import { FeedIdSchema, FeedUrlSchema } from "../domain/subscription.js"
import { openTestDatabase } from "./persistence/testing.js"
import { createFeedSyncQueue } from "./persistence/feed-sync-queue/repository.js"

let jobSequence = 0
const newJobId = () =>
  `00000000-0000-4000-8000-${String(jobSequence++).padStart(12, "0")}`

const feedId = Schema.decodeUnknownSync(FeedIdSchema)(
  "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"
)
const feedUrl = Schema.decodeUnknownSync(FeedUrlSchema)(
  "https://feeds.example.com/news.xml"
)

describe("SQLite feed sync queue", () => {
  it("persists a queued job and makes it visible to the subscribed owner", async () => {
    const database = openTestDatabase()
    try {
      database.execSql(`
        INSERT INTO feed_catalog VALUES (
          '${feedId}', '${feedUrl}', '2026-08-13T01:00:00.000Z'
        );
        INSERT INTO feed_subscriptions VALUES (
          '9aa2225d-07e7-4af4-a8e6-e4788f801a91', 'owner-a',
          '${feedId}', '2026-08-13T01:00:00.000Z', 1
        );
      `)

      const queue = await Effect.runPromise(
        createFeedSyncQueue(database.db, newJobId)
      )
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
    const database = openTestDatabase()
    try {
      database.execSql(`
        INSERT INTO feed_catalog VALUES (
          '${feedId}', '${feedUrl}', '2026-08-13T01:00:00.000Z'
        );
        INSERT INTO feed_subscriptions VALUES (
          '9aa2225d-07e7-4af4-a8e6-e4788f801a91', 'owner-a',
          '${feedId}', '2026-08-13T01:00:00.000Z', 1
        );
      `)

      const queue = await Effect.runPromise(
        createFeedSyncQueue(database.db, newJobId)
      )
      await Effect.runPromise(queue.enqueue(feedId, "2026-08-13T01:00:00.000Z"))
      database.runSql(
        "UPDATE feed_subscriptions SET enabled = 0 WHERE feed_id = ?",
        [feedId]
      )

      await expect(
        Effect.runPromise(
          queue.claim(
            "2026-08-13T01:00:02.000Z",
            "2026-08-13T01:05:02.000Z",
            "lease-disabled"
          )
        )
      ).resolves.toBeUndefined()
    } finally {
      database.close()
    }
  })

  it("retries failed syncs up to the durable attempt limit", async () => {
    const database = openTestDatabase()
    try {
      database.execSql(`
        INSERT INTO feed_catalog VALUES (
          '${feedId}', '${feedUrl}', '2026-08-13T01:00:00.000Z'
        );
        INSERT INTO feed_subscriptions VALUES (
          '9aa2225d-07e7-4af4-a8e6-e4788f801a91', 'owner-a',
          '${feedId}', '2026-08-13T01:00:00.000Z', 1
        );
      `)

      const queue = await Effect.runPromise(
        createFeedSyncQueue(database.db, newJobId)
      )
      let job = await Effect.runPromise(
        queue.enqueue(feedId, "2026-08-13T01:00:00.000Z")
      )
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const claimed = await Effect.runPromise(
          queue.claim(
            `2026-08-13T01:00:0${attempt}.000Z`,
            `2026-08-13T01:05:0${attempt}.000Z`,
            `lease-attempt-${attempt}`
          )
        )
        expect(claimed?.attempt).toBe(attempt)
        job = await Effect.runPromise(
          queue.complete(
            claimed!.jobId,
            claimed!.leaseToken,
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
          queue.claim(
            "2026-08-13T01:01:00.000Z",
            "2026-08-13T01:06:00.000Z",
            "lease-exhausted"
          )
        )
      ).resolves.toBeUndefined()
    } finally {
      database.close()
    }
  })

  it("rejects completion from a worker whose lease was already reclaimed", async () => {
    const database = openTestDatabase()
    try {
      database.execSql(`
        INSERT INTO feed_catalog VALUES (
          '${feedId}', '${feedUrl}', '2026-08-13T01:00:00.000Z'
        );
        INSERT INTO feed_subscriptions VALUES (
          '9aa2225d-07e7-4af4-a8e6-e4788f801a91', 'owner-a',
          '${feedId}', '2026-08-13T01:00:00.000Z', 1
        );
      `)

      const queue = await Effect.runPromise(
        createFeedSyncQueue(database.db, newJobId)
      )
      await Effect.runPromise(queue.enqueue(feedId, "2026-08-13T01:00:00.000Z"))
      const first = await Effect.runPromise(
        queue.claim(
          "2026-08-13T01:00:01.000Z",
          "2026-08-13T01:05:01.000Z",
          "lease-first"
        )
      )
      const reclaimed = await Effect.runPromise(
        queue.claim(
          "2026-08-13T01:06:00.000Z",
          "2026-08-13T01:11:00.000Z",
          "lease-reclaimed"
        )
      )

      expect(first?.leaseToken).toBe("lease-first")
      expect(reclaimed?.leaseToken).toBe("lease-reclaimed")
      await expect(
        Effect.runPromise(
          queue.complete(
            first!.jobId,
            first!.leaseToken,
            { discovered: 99, archived: 99, failed: 0 },
            "2026-08-13T01:06:01.000Z"
          )
        )
      ).rejects.toMatchObject({
        _tag: "FeedSyncQueueFailed",
        operation: "Complete",
        reason: "StaleLease",
      })
    } finally {
      database.close()
    }
  })
})
