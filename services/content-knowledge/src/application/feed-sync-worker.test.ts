import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import { FeedSyncJobSchema } from "../domain/feed-sync.js"
import { runFeedSyncCycle } from "./feed-sync-worker.js"

const job = Schema.decodeUnknownSync(FeedSyncJobSchema)({
  jobId: "8fb12955-2175-4675-be63-e42227d5ed19",
  feedId: "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd",
  feedUrl: "https://feeds.example.com/news.xml",
  status: "Processing",
  attempt: 1,
  maxAttempts: 4,
  discovered: 0,
  archived: 0,
  failed: 0,
  createdAt: "2026-08-13T01:00:00.000Z",
  startedAt: "2026-08-13T01:00:01.000Z",
})
const claimedJob = { ...job, leaseToken: "lease-1" } as const

describe("feed sync worker", () => {
  it("claims, processes, completes, and drains one durable job", async () => {
    const complete = vi.fn(() => Effect.succeed(job))
    const claim = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed(claimedJob))
      .mockReturnValueOnce(Effect.succeed(undefined))
    const pollFeed = vi.fn(() =>
      Effect.succeed({
        feeds: 1,
        discovered: 3,
        archived: 2,
        alreadyArchived: 1,
        failed: 0,
        failures: [],
      })
    )

    const now = vi
      .fn()
      .mockReturnValueOnce("2026-08-13T01:00:00.000Z")
      .mockReturnValueOnce("2026-08-13T01:00:01.000Z")
      .mockReturnValueOnce("2026-08-13T01:00:05.000Z")
      .mockReturnValueOnce("2026-08-13T01:00:06.000Z")

    const newLeaseToken = vi
      .fn()
      .mockReturnValueOnce("lease-1")
      .mockReturnValueOnce("lease-2")
    const result = await Effect.runPromise(
      runFeedSyncCycle({
        subscriptions: {
          listFeedsForPolling: () => Effect.succeed([job]),
        },
        queue: {
          enqueue: vi.fn(),
          enqueueForPolling: vi.fn(() => Effect.void),
          listForOwner: vi.fn(),
          claim,
          complete,
        },
        pollFeed,
        now,
        newLeaseToken,
        leaseMillis: 10_000,
      })()
    )

    expect(result).toMatchObject({ discovered: 3, archived: 2 })
    expect(pollFeed).toHaveBeenCalledWith({
      feedId: job.feedId,
      feedUrl: job.feedUrl,
    })
    expect(complete).toHaveBeenCalledWith(
      job.jobId,
      "lease-1",
      { discovered: 3, archived: 2, failed: 0 },
      "2026-08-13T01:00:05.000Z"
    )
    expect(claim).toHaveBeenNthCalledWith(
      1,
      "2026-08-13T01:00:01.000Z",
      "2026-08-13T01:00:11.000Z",
      "lease-1"
    )
    expect(claim).toHaveBeenNthCalledWith(
      2,
      "2026-08-13T01:00:06.000Z",
      "2026-08-13T01:00:16.000Z",
      "lease-2"
    )
  })
})
