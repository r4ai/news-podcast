import { Schema } from "effect"
import { describe, expect, expectTypeOf, it } from "vitest"

import {
  cancelJob,
  completeRunningJob,
  EpisodeIdSchema,
  failRunningJob,
  JobIdSchema,
  LeaseTokenSchema,
  leaseQueuedJob,
  leaseRetryingJob,
  newQueuedJob,
  retryRunningJob,
  RetryableFailureSchema,
  TerminalFailureSchema,
  IdempotencyKeySchema,
  OwnerIdSchema,
  UtcTimestampSchema,
  type QueuedJob,
  type RetryableRunningJob,
  type RunningJob,
} from "./episode-job.js"

const jobId = Schema.decodeUnknownSync(JobIdSchema)(
  "10e2d4e1-c127-479f-a124-2ea037bd9319"
)
const episodeId = Schema.decodeUnknownSync(EpisodeIdSchema)(
  "6518412b-ce2f-4641-9f2c-a02dd515bc31"
)
const ownerId = Schema.decodeUnknownSync(OwnerIdSchema)(
  "d25da30b-4cd1-4875-94c7-6d48f32b5b1c"
)
const idempotencyKey =
  Schema.decodeUnknownSync(IdempotencyKeySchema)("daily-2026-08-12")
const time = (value: string) =>
  Schema.decodeUnknownSync(UtcTimestampSchema)(value)
const leaseToken = Schema.decodeUnknownSync(LeaseTokenSchema)("lease-1")

const queued = () =>
  newQueuedJob({
    jobId,
    ownerId,
    idempotencyKey,
    trigger: "manual",
    enqueuedAt: time("2026-08-12T00:00:00.000Z"),
  })

describe("episode job state machine", () => {
  it("rejects owner IDs containing whitespace", () => {
    expect(() => Schema.decodeUnknownSync(OwnerIdSchema)("owner id")).toThrow()
  })

  it("constructs a deeply immutable queued job", () => {
    const job = queued()

    expect(job).toMatchObject({ _tag: "Queued", attempt: 0 })
    expect(Object.isFrozen(job)).toBe(true)
    expect(Object.isFrozen(job.request)).toBe(true)
  })

  it("models the successful path as total transitions", () => {
    const running = leaseQueuedJob(queued(), {
      token: leaseToken,
      leasedUntil: time("2026-08-12T00:01:00.000Z"),
      startedAt: time("2026-08-12T00:00:01.000Z"),
    })
    const succeeded = completeRunningJob(running, {
      episodeId,
      completedAt: time("2026-08-12T00:00:30.000Z"),
    })

    expect(running).toMatchObject({ _tag: "Running", attempt: 1 })
    expect(succeeded).toMatchObject({ _tag: "Succeeded", episodeId })
    expect(Schema.encodeSync(UtcTimestampSchema)(running.createdAt)).toBe(
      "2026-08-12T00:00:00.000Z"
    )
    expect(Schema.encodeSync(UtcTimestampSchema)(succeeded.createdAt)).toBe(
      "2026-08-12T00:00:00.000Z"
    )
    expect(Object.isFrozen(succeeded)).toBe(true)
  })

  it("keeps retry and cancellation reasons explicit", () => {
    const running = leaseQueuedJob(queued(), {
      token: leaseToken,
      leasedUntil: time("2026-08-12T00:01:00.000Z"),
      startedAt: time("2026-08-12T00:00:01.000Z"),
    })
    const retrying = retryRunningJob(running, {
      retryAt: time("2026-08-12T00:01:30.000Z"),
      failure: Schema.decodeUnknownSync(RetryableFailureSchema)({
        code: "script_unavailable",
        retryable: true,
      }),
    })
    const canceled = cancelJob(queued(), {
      canceledAt: time("2026-08-12T00:00:02.000Z"),
      reason: "requested_by_user",
    })

    expect(Schema.encodeSync(UtcTimestampSchema)(retrying.createdAt)).toBe(
      "2026-08-12T00:00:00.000Z"
    )
    expect(Schema.encodeSync(UtcTimestampSchema)(canceled.createdAt)).toBe(
      "2026-08-12T00:00:00.000Z"
    )

    expect(retrying).toMatchObject({ _tag: "Retrying", attempt: 1 })
    expect(canceled).toMatchObject({
      _tag: "Canceled",
      reason: "requested_by_user",
    })

    const runningAgain = leaseRetryingJob(retrying, {
      token: leaseToken,
      leasedUntil: time("2026-08-12T00:03:00.000Z"),
      startedAt: time("2026-08-12T00:02:00.000Z"),
    })
    expect(runningAgain).toMatchObject({ _tag: "Running", attempt: 2 })
  })

  it("represents a non-retryable failure as a terminal state", () => {
    const running = leaseQueuedJob(queued(), {
      token: leaseToken,
      leasedUntil: time("2026-08-12T00:01:00.000Z"),
      startedAt: time("2026-08-12T00:00:01.000Z"),
    })
    const failed = failRunningJob(running, {
      failedAt: time("2026-08-12T00:00:10.000Z"),
      failure: Schema.decodeUnknownSync(TerminalFailureSchema)({
        code: "script_malformed_response",
        retryable: false,
      }),
    })

    expect(failed).toMatchObject({
      _tag: "Failed",
      failure: { retryable: false },
    })
  })

  it("exposes transition inputs that make terminal-state transitions unrepresentable", () => {
    expectTypeOf(leaseQueuedJob).parameter(0).toEqualTypeOf<QueuedJob>()
    expectTypeOf(completeRunningJob).parameter(0).toEqualTypeOf<RunningJob>()
    expectTypeOf(retryRunningJob)
      .parameter(0)
      .toEqualTypeOf<RetryableRunningJob>()
  })
})
