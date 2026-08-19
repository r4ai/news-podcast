import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  cancelOwnedJob,
  getOwnedJob,
  listOwnedJobs,
  retryFailedJob,
} from "./job-control.js"
import {
  cancelJob,
  CreateJobCommandSchema,
  JobIdSchema,
  UtcTimestampSchema,
  failRunningJob,
  leaseQueuedJob,
  newQueuedJob,
} from "../domain/episode-job.js"

const originalId = Schema.decodeUnknownSync(JobIdSchema)(
  "10e2d4e1-c127-479f-a124-2ea037bd9319"
)
const retriedId = Schema.decodeUnknownSync(JobIdSchema)(
  "6518412b-ce2f-4641-9f2c-a02dd515bc31"
)
const now = Schema.decodeUnknownSync(UtcTimestampSchema)(
  "2026-08-13T00:00:00.000Z"
)
const command = Schema.decodeUnknownSync(CreateJobCommandSchema)({
  ownerId: "owner-1",
  idempotencyKey: "original",
  trigger: "scheduled",
  articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3a80"],
})
const queued = newQueuedJob({
  jobId: originalId,
  ...command,
  enqueuedAt: now,
})

describe("episode job control", () => {
  it("gets, lists, and cancels through owner-scoped ports", async () => {
    const findOwned = vi.fn(() => Effect.succeed(queued))
    const listOwned = vi.fn(() => Effect.succeed([queued]))
    const cancelOwned = vi.fn(() =>
      Effect.succeed({
        _tag: "Canceled" as const,
        job: cancelJob(
          leaseQueuedJob(queued, {
            token: "lease-cancel" as never,
            startedAt: now,
            leasedUntil: now,
          }),
          { canceledAt: now, reason: "requested_by_user" }
        ),
      })
    )
    const ports = { findOwned, listOwned, cancelOwned }

    const [found, listed, canceled] = await Effect.runPromise(
      Effect.all([
        getOwnedJob(ports, command.ownerId, originalId),
        listOwnedJobs(ports, command.ownerId, 25),
        cancelOwnedJob(ports, command.ownerId, originalId, now),
      ])
    )

    expect(found).toBe(queued)
    expect(listed).toEqual([queued])
    expect(canceled._tag).toBe("Canceled")
    expect(findOwned).toHaveBeenCalledWith(command.ownerId, originalId)
    expect(listOwned).toHaveBeenCalledWith(command.ownerId, 25)
  })

  it("retries a failed job under a new ID with its immutable selection", async () => {
    const failed = failRunningJob(
      leaseQueuedJob(queued, {
        token: "lease-1" as never,
        startedAt: now,
        leasedUntil: now,
      }),
      {
        failedAt: now,
        failure: { code: "provider-timeout" as never, retryable: false },
      }
    )
    const saveRetryIdempotently = vi.fn((_sourceJobId, job) =>
      Effect.succeed(job)
    )

    const retried = await Effect.runPromise(
      retryFailedJob(
        {
          findOwned: () => Effect.succeed(failed),
          nextJobId: Effect.succeed(retriedId),
          now: Effect.succeed(now),
          saveRetryIdempotently,
        },
        command.ownerId,
        originalId,
        "manual-retry-1" as never
      )
    )

    expect(retried).toMatchObject({
      _tag: "Queued",
      jobId: retriedId,
      request: {
        trigger: "scheduled",
        idempotencyKey: "manual-retry-1",
        articleIds: command.articleIds,
      },
    })
    expect(saveRetryIdempotently).toHaveBeenCalledWith(
      originalId,
      expect.objectContaining({ jobId: retriedId })
    )
  })

  it("does not retry missing or non-failed jobs", async () => {
    const common = {
      nextJobId: Effect.succeed(retriedId),
      now: Effect.succeed(now),
      saveRetryIdempotently: vi.fn((_sourceJobId, job) => Effect.succeed(job)),
    }
    const missing = await Effect.runPromise(
      retryFailedJob(
        { ...common, findOwned: () => Effect.succeed(undefined) },
        command.ownerId,
        originalId,
        "retry" as never
      )
    )
    const conflict = await Effect.runPromise(
      retryFailedJob(
        { ...common, findOwned: () => Effect.succeed(queued) },
        command.ownerId,
        originalId,
        "retry" as never
      )
    )

    expect(missing).toEqual({ _tag: "NotFound" })
    expect(conflict).toEqual({ _tag: "NotFailed" })
    expect(common.saveRetryIdempotently).not.toHaveBeenCalled()
  })
})
