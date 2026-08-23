import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  handleCancelJobRpc,
  handleGetJobRpc,
  handleListJobsRpc,
  handleListJobEventsRpc,
  handleRetryJobRpc,
  type JobControlRpcDelivery,
} from "./job-control.js"
import {
  CreateJobCommandSchema,
  JobIdSchema,
  UtcTimestampSchema,
  cancelJob,
  failRunningJob,
  leaseQueuedJob,
  newQueuedJob,
} from "../../domain/episode-job.js"

const jobId = Schema.decodeUnknownSync(JobIdSchema)(
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
  trigger: "manual",
})
const queued = newQueuedJob({ jobId, ...command, enqueuedAt: now })
const replyDependencies = {
  newMessageId: () => "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  now: () => "2026-08-13T00:00:01.000Z",
}
const replyPayload = (reply: string): Record<string, unknown> => {
  const decoded = JSON.parse(reply) as Record<string, unknown>
  return (decoded.payload ?? decoded) as Record<string, unknown>
}

const envelope = (
  payload: unknown,
  actor: unknown = { _tag: "User", userId: "owner-1" }
) => ({
  messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
  causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
  occurredAt: "2026-08-13T00:00:00.000Z",
  producer: "gateway",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  actor,
  payload,
})

const delivery = (
  payload: unknown,
  replies: string[]
): JobControlRpcDelivery => ({
  payload: JSON.stringify(payload),
  reply: (reply) => Effect.sync(() => void replies.push(reply)),
})

describe("episode job-control NATS RPC", () => {
  it("gets and lists only through the actor-derived owner", async () => {
    const replies: string[] = []
    const findOwned = vi.fn(() => Effect.succeed(queued))
    const listOwned = vi.fn(() => Effect.succeed([queued]))

    await Effect.runPromise(
      handleGetJobRpc({ findOwned, replyDependencies })(
        delivery(envelope({ jobId }), replies)
      )
    )
    await Effect.runPromise(
      handleListJobsRpc({ listOwned, replyDependencies })(
        delivery(envelope({ limit: 10 }), replies)
      )
    )

    expect(findOwned).toHaveBeenCalledWith(command.ownerId, jobId)
    expect(listOwned).toHaveBeenCalledWith(command.ownerId, 10)
    expect(JSON.parse(replies[0]!)).toMatchObject({
      correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
      causationId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
      producer: "episode-production",
      actor: { _tag: "Service", service: "episode-production" },
    })
    expect(replyPayload(replies[0]!)).toEqual({
      _tag: "Found",
      job: {
        jobId,
        createdAt: "2026-08-13T00:00:00.000Z",
        status: "queued",
        trigger: "manual",
        attempt: 0,
        maxAttempts: 4,
        enqueuedAt: "2026-08-13T00:00:00.000Z",
      },
    })
    expect(JSON.stringify(replies)).not.toContain("owner-1")
    expect(replyPayload(replies[1]!)).toMatchObject({ _tag: "Listed" })
  })

  it("replays durable state events strictly after the supplied cursor", async () => {
    const replies: string[] = []
    const findOwned = vi.fn(() => Effect.succeed(queued))
    const listOwnedAgUiEvents = vi.fn(() =>
      Effect.succeed([
        { sequence: 42, event: { type: "STATE_SNAPSHOT", snapshot: {} } },
      ])
    )

    await Effect.runPromise(
      handleListJobEventsRpc({
        findOwned,
        listOwnedAgUiEvents,
        replyDependencies,
      })(delivery(envelope({ jobId, afterSequence: 41, limit: 20 }), replies))
    )

    expect(listOwnedAgUiEvents).toHaveBeenCalledWith({
      ownerId: command.ownerId,
      jobId,
      afterSequence: 41,
      limit: 20,
    })
    expect(replyPayload(replies[0]!)).toMatchObject({
      _tag: "Events",
      events: [
        { sequence: 42, event: { type: "STATE_SNAPSHOT", snapshot: {} } },
      ],
    })
  })

  it("maps cancellation states without turning conflicts into timeouts", async () => {
    const replies: string[] = []
    const cancelOwned = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed({ _tag: "NotFound" as const }))
      .mockReturnValueOnce(Effect.succeed({ _tag: "Terminal" as const }))

    const handler = handleCancelJobRpc({
      cancelOwned,
      now: Effect.succeed(now),
      replyDependencies,
    })
    await Effect.runPromise(handler(delivery(envelope({ jobId }), replies)))
    await Effect.runPromise(handler(delivery(envelope({ jobId }), replies)))

    expect(replies.map(replyPayload)).toEqual([
      { _tag: "NotFound" },
      { _tag: "Conflict", code: "JOB_TERMINAL" },
    ])
  })

  it("notifies the local worker after durable cancellation and before replying", async () => {
    const order: string[] = []
    const running = leaseQueuedJob(queued, {
      token: "lease-1" as never,
      startedAt: now,
      leasedUntil: now,
    })
    const canceled = cancelJob(running, {
      canceledAt: now,
      reason: "requested_by_user",
    })
    const replies: string[] = []
    const handler = handleCancelJobRpc({
      cancelOwned: () =>
        Effect.sync(() => {
          order.push("persisted")
          return { _tag: "Canceled" as const, job: canceled }
        }),
      onCanceled: (job) => {
        order.push("notified")
        expect(job).toBe(canceled)
      },
      now: Effect.succeed(now),
      replyDependencies,
    })
    const request = delivery(envelope({ jobId }), replies)

    await Effect.runPromise(
      handler({
        ...request,
        reply: (payload) =>
          Effect.sync(() => {
            order.push("replied")
            replies.push(payload)
          }),
      })
    )

    expect(order).toEqual(["persisted", "notified", "replied"])
    expect(replyPayload(replies[0]!)).toMatchObject({ _tag: "Canceled" })
  })

  it("returns a new queued projection for a retry", async () => {
    const replies: string[] = []
    const retried = newQueuedJob({
      jobId: retriedId,
      ...command,
      idempotencyKey: "retry-1" as never,
      enqueuedAt: now,
    })
    const retry = vi.fn(() => Effect.succeed(retried))

    await Effect.runPromise(
      handleRetryJobRpc({ retry, replyDependencies })(
        delivery(envelope({ jobId, idempotencyKey: "retry-1" }), replies)
      )
    )

    expect(retry).toHaveBeenCalledWith(command.ownerId, jobId, "retry-1")
    expect(replyPayload(replies[0]!)).toMatchObject({
      _tag: "Retried",
      job: { jobId: retriedId, status: "queued" },
    })
  })

  it("returns the existing active job reference when retry admission rejects", async () => {
    const replies: string[] = []

    await Effect.runPromise(
      handleRetryJobRpc({
        retry: () =>
          Effect.fail({
            _tag: "OwnerActiveJobConflict" as const,
            activeJob: queued,
          }),
        replyDependencies,
      })(delivery(envelope({ jobId, idempotencyKey: "retry-1" }), replies))
    )

    expect(replyPayload(replies[0]!)).toEqual({
      _tag: "ActiveJobConflict",
      activeJobId: jobId,
    })
  })

  it("replays the persisted terminal retry result for an explicit key", async () => {
    const replies: string[] = []
    const retried = newQueuedJob({
      jobId: retriedId,
      ...command,
      idempotencyKey: "retry-1" as never,
      enqueuedAt: now,
    })
    const failed = failRunningJob(
      leaseQueuedJob(retried, {
        token: "lease-retry" as never,
        startedAt: now,
        leasedUntil: now,
      }),
      {
        failedAt: now,
        failure: { code: "script_timeout", retryable: false },
      }
    )

    await Effect.runPromise(
      handleRetryJobRpc({
        retry: () => Effect.succeed(failed),
        replyDependencies,
      })(delivery(envelope({ jobId, idempotencyKey: "retry-1" }), replies))
    )

    expect(replyPayload(replies[0]!)).toMatchObject({
      _tag: "Retried",
      job: { jobId: retriedId, status: "failed" },
    })
  })

  it("rejects anonymous, forged-owner, and malformed requests before storage", async () => {
    const replies: string[] = []
    const findOwned = vi.fn()
    const handler = handleGetJobRpc({ findOwned, replyDependencies })

    await Effect.runPromise(
      handler(delivery(envelope({ jobId }, { _tag: "Anonymous" }), replies))
    )
    await Effect.runPromise(
      handler(delivery(envelope({ jobId, ownerId: "victim" }), replies))
    )
    await Effect.runPromise(
      handler({
        payload: "{invalid",
        reply: (reply) => Effect.sync(() => void replies.push(reply)),
      })
    )

    expect(findOwned).not.toHaveBeenCalled()
    expect(replies.map((reply) => replyPayload(reply).code)).toEqual([
      "UNAUTHENTICATED",
      "INVALID_REQUEST",
    ])
  })
})
