import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"
import { FeedIdSchema, FeedUrlSchema } from "../domain/subscription.js"
import { parseRssFeed } from "./providers/rss/feed-parser.js"
import { openTestDatabase } from "./persistence/testing.js"
import { createFeedSyncQueue } from "./persistence/feed-sync-queue/repository.js"

import { pollFeedBatch } from "../application/feed-batch.js"
import { runFeedSyncCycle } from "../application/feed-sync-worker.js"
import { deriveArticleIdentityUnsafe } from "../infrastructure/unsafe/identity.js"

const feedId = Schema.decodeUnknownSync(FeedIdSchema)(
  "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"
)
const feedUrl = Schema.decodeUnknownSync(FeedUrlSchema)(
  "https://feeds.example.com/news.xml"
)
const now = "2026-09-11T00:00:00.000Z"

describe("feed work bounds", () => {
  it("rejects excessive invalid entries before normalizing every item", () => {
    expect(() =>
      parseRssFeed(
        `<rss><channel>${"<item/>".repeat(1001)}</channel></rss>`,
        feedUrl
      )
    ).toThrow(expect.objectContaining({ reason: "ResourceLimit" }))
  })

  it("fences completion at the lease boundary even before another worker claims", async () => {
    const database = openTestDatabase()
    try {
      database.execSql(`INSERT INTO feed_catalog VALUES ('${feedId}', '${feedUrl}', '${now}');
        INSERT INTO feed_subscriptions VALUES ('subscription-a', 'owner-a', '${feedId}', '${now}', 1);`)
      const queue = await Effect.runPromise(
        createFeedSyncQueue(
          database.db,
          () => "00000000-0000-4000-8000-000000000001"
        )
      )
      const job = await Effect.runPromise(queue.enqueue(feedId, now))
      const expires = "2026-09-11T00:05:00.000Z"
      await Effect.runPromise(queue.claim(now, expires, "first"))
      await expect(
        Effect.runPromise(
          queue.complete(
            job.jobId,
            "first",
            { discovered: 1, archived: 1, failed: 0 },
            expires
          )
        )
      ).rejects.toMatchObject({ reason: "StaleLease" })
    } finally {
      database.close()
    }
  })
})

it("rotates an eleven-slow-item snapshot behind a healthy feed, survives worker recreation, and does not spend retries on yielding", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
  const database = openTestDatabase()
  const healthyId = Schema.decodeUnknownSync(FeedIdSchema)(
    "8d90a18a-7eb5-47bb-b6c1-1c9709b80cde"
  )
  const healthyUrl = Schema.decodeUnknownSync(FeedUrlSchema)(
    "https://healthy.example.com/feed"
  )
  const feeds = [
    { feedId, feedUrl },
    { feedId: healthyId, feedUrl: healthyUrl },
  ]
  try {
    feeds.forEach((feed, i) =>
      database.execSql(`INSERT INTO feed_catalog VALUES ('${feed.feedId}', '${feed.feedUrl}', '${now}');
      INSERT INTO feed_subscriptions VALUES ('subscription-${i}', 'owner-${i}', '${feed.feedId}', '${now}', 1);`)
    )
    let sequence = 0
    const queue = await Effect.runPromise(
      createFeedSyncQueue(
        database.db,
        () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
      )
    )
    const reads: string[] = []
    const archives: string[] = []
    const clock = () => new Date().toISOString()
    const makeRun = () =>
      runFeedSyncCycle({
        subscriptions: { listFeedsForPolling: () => Effect.succeed(feeds) },
        queue,
        now: clock,
        newLeaseToken: () => `lease-${++sequence}`,
        pollFeed: pollFeedBatch({
          subscriptions: { listFeedsForPolling: () => Effect.succeed(feeds) },
          now: clock,
          reader: {
            read: (url) =>
              Effect.sync(() => {
                reads.push(url)
                return parseRssFeed(
                  `<rss><channel>${Array.from({ length: url === feedUrl ? 11 : 1 }, (_, i) => `<item><title>Item ${i}</title><link>${url}/${i}</link></item>`).join("")}</channel></rss>`,
                  url
                )
              }),
          },
          deriveArticleIdentity: deriveArticleIdentityUnsafe,
          newContext: () => ({}) as never,
          archive: ({ command }) =>
            Effect.sync(() => archives.push(command.sourceUrl)).pipe(
              Effect.andThen(
                command.sourceUrl.startsWith(feedUrl)
                  ? Effect.sleep(29_000)
                  : Effect.void
              ),
              Effect.as({ _tag: "Archived" } as never)
            ),
        }),
      })
    const firstCycle = Effect.runPromise(makeRun()())
    await vi.advanceTimersByTimeAsync(150_000)
    expect((await firstCycle).hasPending).toBe(true)
    expect(archives.slice(0, 3)).toEqual([
      `${feedUrl}/0`,
      `${healthyUrl}/0`,
      `${feedUrl}/1`,
    ])
    expect(
      (await Effect.runPromise(queue.listForOwner("owner-0" as never)))[0]
    ).toMatchObject({ status: "Queued", attempt: 0, archived: 5 })
    const nextCycle = Effect.runPromise(makeRun()())
    await vi.advanceTimersByTimeAsync(180_000)
    await nextCycle
    expect(reads).toEqual([feedUrl, healthyUrl])
    expect(archives).toHaveLength(12)
    expect(new Set(archives).size).toBe(12)
    expect(
      (await Effect.runPromise(queue.listForOwner("owner-0" as never)))[0]
    ).toMatchObject({ status: "Succeeded", attempt: 1, archived: 11 })
  } finally {
    database.close()
    vi.useRealTimers()
  }
})

it("aborts a stuck outbound operation before its lease can be reclaimed", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
  const database = openTestDatabase()
  try {
    database.execSql(`INSERT INTO feed_catalog VALUES ('${feedId}', '${feedUrl}', '${now}');
      INSERT INTO feed_subscriptions VALUES ('subscription-a', 'owner-a', '${feedId}', '${now}', 1);`)
    const queue = await Effect.runPromise(
      createFeedSyncQueue(
        database.db,
        () => "00000000-0000-4000-8000-000000000001"
      )
    )
    let aborted = false
    const run = Effect.runPromise(
      runFeedSyncCycle({
        subscriptions: {
          listFeedsForPolling: () => Effect.succeed([{ feedId, feedUrl }]),
        },
        queue,
        now: () => new Date().toISOString(),
        newLeaseToken: () => "worker-1",
        pollFeed: () =>
          Effect.tryPromise({
            try: (signal) =>
              new Promise<never>(() =>
                signal.addEventListener("abort", () => {
                  aborted = true
                })
              ),
            catch: () => "failed",
          }),
      })()
    )
    await vi.advanceTimersByTimeAsync(44_999)
    expect(aborted).toBe(false)
    expect(
      await Effect.runPromise(
        queue.claim(
          new Date().toISOString(),
          "2026-09-11T00:10:00.000Z",
          "worker-2"
        )
      )
    ).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await run
    expect(aborted).toBe(true)
    expect(
      (await Effect.runPromise(queue.listForOwner("owner-a" as never)))[0]
    ).toMatchObject({ status: "Failed", error: "WorkBudget" })
  } finally {
    database.close()
    vi.useRealTimers()
  }
})

it.each([
  { label: "per-owner", owners: ["a", "a", "a"], accepted: 2 },
  { label: "global", owners: ["a", "a", "b", "b", "c", "c", "d"], accepted: 6 },
])(
  "enforces $label admission before a feed can occupy the worker",
  async ({ owners, accepted }) => {
    const database = openTestDatabase()
    try {
      let sequence = 0
      const queue = await Effect.runPromise(
        createFeedSyncQueue(
          database.db,
          () =>
            `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
        )
      )
      for (const [i, owner] of owners.entries()) {
        const id = Schema.decodeUnknownSync(FeedIdSchema)(
          `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
        )
        database.execSql(`INSERT INTO feed_catalog VALUES ('${id}', 'https://example.com/${i}', '${now}');
        INSERT INTO feed_subscriptions VALUES ('subscription-${i}', '${owner}', '${id}', '${now}', 1);`)
        const result = Effect.runPromise(queue.enqueue(id, now))
        if (i < accepted)
          await expect(result).resolves.toMatchObject({ status: "Queued" })
        else
          await expect(result).rejects.toMatchObject({
            reason: "ResourceLimit",
          })
      }
    } finally {
      database.close()
    }
  }
)

it("persists a checkpoint across queue recreation and fences expired or replaced writers", async () => {
  const database = openTestDatabase()
  try {
    database.execSql(`INSERT INTO feed_catalog VALUES ('${feedId}', '${feedUrl}', '${now}');
      INSERT INTO feed_subscriptions VALUES ('subscription-a', 'owner-a', '${feedId}', '${now}', 1);`)
    const create = () =>
      Effect.runPromise(
        createFeedSyncQueue(
          database.db,
          () => "00000000-0000-4000-8000-000000000001"
        )
      )
    const queue = await create()
    const job = await Effect.runPromise(queue.enqueue(feedId, now))
    const expires = "2026-09-11T00:05:00.000Z"
    const snapshot = parseRssFeed(
      "<rss><channel><item><title>Saved</title><link>https://example.com/saved</link></item></channel></rss>",
      feedUrl
    )
    await Effect.runPromise(queue.claim(now, expires, "first"))
    await Effect.runPromise(queue.checkpoint(job.jobId, "first", snapshot, now))
    await expect(
      Effect.runPromise(
        queue.checkpoint(
          job.jobId,
          "first",
          { items: [], failures: [] },
          expires
        )
      )
    ).rejects.toMatchObject({ reason: "StaleLease" })
    const restarted = await create()
    expect(
      await Effect.runPromise(
        restarted.claim(expires, "2026-09-11T00:10:00.000Z", "second")
      )
    ).toMatchObject({ attempt: 2, continuation: snapshot })
    await expect(
      Effect.runPromise(
        queue.checkpoint(
          job.jobId,
          "first",
          { items: [], failures: [] },
          expires
        )
      )
    ).rejects.toMatchObject({ reason: "StaleLease" })
    await expect(
      Effect.runPromise(
        queue.complete(
          job.jobId,
          "first",
          { discovered: 1, archived: 1, failed: 0 },
          expires
        )
      )
    ).rejects.toMatchObject({ reason: "StaleLease" })
  } finally {
    database.close()
  }
})

it("slices an all-invalid feed instead of looping over every failure in one claim", async () => {
  const snapshot = parseRssFeed(
    `<rss><channel>${"<item/>".repeat(1_000)}</channel></rss>`,
    feedUrl
  )
  let saved = false
  const result = await Effect.runPromise(
    pollFeedBatch({
      subscriptions: { listFeedsForPolling: () => Effect.succeed([]) },
      reader: { read: () => Effect.succeed(snapshot) },
      archive: () => Effect.die("must not archive invalid entries"),
      deriveArticleIdentity: deriveArticleIdentityUnsafe,
      newContext: () => ({}) as never,
      now: () => now,
    })(
      { feedId, feedUrl },
      {
        checkpoint: () =>
          Effect.sync(() => {
            saved = true
          }),
      }
    )
  )
  expect(saved).toBe(true)
  expect(result).toMatchObject({ discovered: 1, failed: 1 })
  expect(result.continuation?.failures).toHaveLength(999)
})

it("times out a poison article and preserves its sibling for the next claim", async () => {
  vi.useFakeTimers()
  try {
    const snapshot = parseRssFeed(
      "<rss><channel><item><title>A</title><link>https://example.com/a</link></item><item><title>B</title><link>https://example.com/b</link></item></channel></rss>",
      feedUrl
    )
    const pending = Effect.runPromise(
      pollFeedBatch({
        subscriptions: { listFeedsForPolling: () => Effect.succeed([]) },
        reader: { read: () => Effect.die("must resume saved snapshot") },
        archive: () => Effect.never,
        deriveArticleIdentity: deriveArticleIdentityUnsafe,
        newContext: () => ({}) as never,
        now: () => now,
      })(
        { feedId, feedUrl },
        { continuation: snapshot, checkpoint: () => Effect.void }
      )
    )
    await vi.advanceTimersByTimeAsync(30_000)
    const result = await pending
    expect(result).toMatchObject({
      failed: 1,
      budgetExhausted: true,
      failures: [{ scope: "Item", reason: "ArchiveFailed" }],
    })
    expect(result.continuation?.items.map((item) => item.title)).toEqual(["B"])
  } finally {
    vi.useRealTimers()
  }
})

it("does not turn a six-feed transient outage into rapid retry exhaustion", async () => {
  const database = openTestDatabase()
  try {
    let sequence = 0
    let clock = now
    const feeds = Array.from({ length: 6 }, (_, i) => ({
      feedId: Schema.decodeUnknownSync(FeedIdSchema)(
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
      ),
      feedUrl: Schema.decodeUnknownSync(FeedUrlSchema)(
        `https://example.com/${i}`
      ),
    }))
    feeds.forEach((feed, i) =>
      database.execSql(`INSERT INTO feed_catalog VALUES ('${feed.feedId}', '${feed.feedUrl}', '${now}');
      INSERT INTO feed_subscriptions VALUES ('subscription-${i}', 'owner-${i}', '${feed.feedId}', '${now}', 1);`)
    )
    const queue = await Effect.runPromise(
      createFeedSyncQueue(
        database.db,
        () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
      )
    )
    const run = runFeedSyncCycle({
      subscriptions: { listFeedsForPolling: () => Effect.succeed(feeds) },
      queue,
      now: () => clock,
      newLeaseToken: () => `lease-${++sequence}`,
      pollFeed: () => Effect.fail({ _tag: "FeedFetchFailed" }),
    })
    const result = await Effect.runPromise(run())
    expect(result.hasPending ?? false).toBe(false)
    clock = "2026-09-11T00:00:00.100Z"
    expect((await Effect.runPromise(run())).feeds).toBe(0)
    expect(
      (await Effect.runPromise(queue.listForOwner("owner-0" as never)))[0]
        ?.attempt
    ).toBe(1)
  } finally {
    database.close()
  }
})

it("does not label a recovered feed as having failed articles", async () => {
  const database = openTestDatabase()
  try {
    database.execSql(`INSERT INTO feed_catalog VALUES ('${feedId}', '${feedUrl}', '${now}');
      INSERT INTO feed_subscriptions VALUES ('subscription-a', 'owner-a', '${feedId}', '${now}', 1);`)
    const queue = await Effect.runPromise(
      createFeedSyncQueue(
        database.db,
        () => "00000000-0000-4000-8000-000000000001"
      )
    )
    const job = await Effect.runPromise(queue.enqueue(feedId, now))
    await Effect.runPromise(
      queue.claim(now, "2026-09-11T00:05:00.000Z", "first")
    )
    await Effect.runPromise(
      queue.complete(
        job.jobId,
        "first",
        {
          discovered: 0,
          archived: 0,
          failed: 1,
          failureScope: "Feed",
          error: "HttpStatus",
        },
        now
      )
    )
    const retryAt = "2026-09-11T00:05:01.000Z"
    await Effect.runPromise(
      queue.enqueueForPolling([{ feedId, feedUrl }], retryAt)
    )
    await Effect.runPromise(
      queue.claim(retryAt, "2026-09-11T00:10:01.000Z", "second")
    )
    const result = await Effect.runPromise(
      queue.complete(
        job.jobId,
        "second",
        { discovered: 1, archived: 1, failed: 0 },
        retryAt
      )
    )
    expect(result).toMatchObject({
      status: "Succeeded",
      failed: 0,
      archived: 1,
    })
    expect(result.error).toBeUndefined()
  } finally {
    database.close()
  }
})

it("loads scheduling metadata once for a large existing catalog", async () => {
  const database = openTestDatabase()
  try {
    const feeds = Array.from({ length: 100 }, (_, i) => ({
      feedId: Schema.decodeUnknownSync(FeedIdSchema)(
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
      ),
      feedUrl: Schema.decodeUnknownSync(FeedUrlSchema)(
        `https://example.com/${i}`
      ),
    }))
    feeds.forEach((feed, i) =>
      database.execSql(`INSERT INTO feed_catalog VALUES ('${feed.feedId}', '${feed.feedUrl}', '${now}');
      INSERT INTO feed_subscriptions VALUES ('subscription-${i}', 'owner-${i}', '${feed.feedId}', '${now}', 1);
      INSERT INTO feed_sync_jobs (job_id, feed_id, status, created_at) VALUES ('${feed.feedId}', '${feed.feedId}', 'Queued', '${now}');`)
    )
    const queue = await Effect.runPromise(
      createFeedSyncQueue(
        database.db,
        () => "00000000-0000-4000-8000-000000000001"
      )
    )
    const prepared = vi.spyOn(database.client, "prepare")
    await Effect.runPromise(queue.enqueueForPolling(feeds, now))
    const reads = prepared.mock.calls.filter(([sql]) =>
      /^select/i.test(sql.trim())
    )
    expect(reads.length).toBeLessThanOrEqual(2)
    prepared.mockRestore()
  } finally {
    database.close()
  }
})

it("preserves real item failures and continuation progress through a feed-level retry", async () => {
  const database = openTestDatabase()
  try {
    database.execSql(`INSERT INTO feed_catalog VALUES ('${feedId}', '${feedUrl}', '${now}');
      INSERT INTO feed_subscriptions VALUES ('subscription-a', 'owner-a', '${feedId}', '${now}', 1);`)
    const queue = await Effect.runPromise(
      createFeedSyncQueue(
        database.db,
        () => "00000000-0000-4000-8000-000000000001"
      )
    )
    const job = await Effect.runPromise(queue.enqueue(feedId, now))
    const snapshot = parseRssFeed(
      "<rss><channel><item><title>Remaining</title><link>https://example.com/remaining</link></item></channel></rss>",
      feedUrl
    )
    await Effect.runPromise(
      queue.claim(now, "2026-09-11T00:05:00.000Z", "first")
    )
    await Effect.runPromise(
      queue.complete(
        job.jobId,
        "first",
        {
          discovered: 1,
          archived: 0,
          failed: 1,
          failureScope: "Item",
          error: "ArchiveFailed",
        },
        now,
        snapshot
      )
    )
    await Effect.runPromise(
      queue.claim(now, "2026-09-11T00:05:00.000Z", "second")
    )
    await Effect.runPromise(
      queue.complete(
        job.jobId,
        "second",
        {
          discovered: 1,
          archived: 0,
          failed: 1,
          failureScope: "Feed",
          error: "CatalogFailed",
        },
        now
      )
    )
    const retryAt = "2026-09-11T00:05:01.000Z"
    await Effect.runPromise(
      queue.enqueueForPolling([{ feedId, feedUrl }], retryAt)
    )
    expect(
      await Effect.runPromise(
        queue.claim(retryAt, "2026-09-11T00:10:01.000Z", "third")
      )
    ).toMatchObject({ continuation: snapshot })
    const recovered = await Effect.runPromise(
      queue.complete(
        job.jobId,
        "third",
        { discovered: 1, archived: 1, failed: 0 },
        retryAt
      )
    )
    expect(recovered).toMatchObject({
      status: "Succeeded",
      discovered: 2,
      archived: 1,
      failed: 1,
      error: "ArchiveFailed",
    })
  } finally {
    database.close()
  }
})
