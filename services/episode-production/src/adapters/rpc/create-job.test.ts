import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import { handleCreateJobRpc, type CreateJobRpcDelivery } from "./create-job.js"
import {
  JobIdSchema,
  UtcTimestampSchema,
  type QueuedJob,
} from "../../domain/episode-job.js"

const jobId = Schema.decodeUnknownSync(JobIdSchema)(
  "10e2d4e1-c127-479f-a124-2ea037bd9319"
)
const now = Schema.decodeUnknownSync(UtcTimestampSchema)(
  "2026-08-12T00:00:00.000Z"
)

const envelope = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
  causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
  occurredAt: "2026-08-12T00:00:00.000Z",
  producer: "gateway",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  actor: {
    _tag: "User",
    userId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
  },
  payload: {
    idempotencyKey: "daily-2026-08-12",
    trigger: "manual",
    articleIds: [
      "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
      "3c4d046c-b47b-4047-a562-66ac7e74e995",
    ],
  },
  ...overrides,
})

const delivery = (input: unknown, replies: string[]): CreateJobRpcDelivery => ({
  payload: JSON.stringify(input),
  reply: (payload) => Effect.sync(() => void replies.push(payload)),
})

describe("create-job NATS RPC adapter", () => {
  it("derives owner from the trusted envelope actor and returns a v1 reply", async () => {
    const saved: unknown[] = []
    const replies: string[] = []
    const handler = handleCreateJobRpc({
      nextJobId: Effect.succeed(jobId),
      now: Effect.succeed(now),
      saveIdempotently: (job) =>
        Effect.sync(() => void saved.push(job)).pipe(Effect.as(job)),
    })

    await Effect.runPromise(handler(delivery(envelope(), replies)))

    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      request: {
        ownerId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
        articleIds: [
          "3c4d046c-b47b-4047-a562-66ac7e74e995",
          "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
        ],
      },
    })
    expect(JSON.parse(replies[0]!)).toEqual({
      protocolVersion: "production.create-job.reply.v1",
      _tag: "Accepted",
      correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
      jobId: "10e2d4e1-c127-479f-a124-2ea037bd9319",
      state: "Queued",
    })
  })

  it("accepts a non-UUID authenticated provider subject", async () => {
    const saved: QueuedJob[] = []
    const replies: string[] = []
    const handler = handleCreateJobRpc({
      nextJobId: Effect.succeed(jobId),
      now: Effect.succeed(now),
      saveIdempotently: (job) =>
        Effect.sync(() => {
          saved.push(job)
          return job
        }),
    })

    await Effect.runPromise(
      handler({
        payload: JSON.stringify(
          envelope({ actor: { _tag: "User", userId: "better-auth-user-1" } })
        ),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    expect(saved[0]?.request.ownerId).toBe("better-auth-user-1")
    expect(replies).toHaveLength(1)
  })

  it("rejects a forged payload owner before invoking the use case", async () => {
    const saveIdempotently = vi.fn()
    const replies: string[] = []
    const handler = handleCreateJobRpc({
      nextJobId: Effect.succeed(jobId),
      now: Effect.succeed(now),
      saveIdempotently,
    })

    await Effect.runPromise(
      handler(
        delivery(
          envelope({
            payload: {
              idempotencyKey: "daily-2026-08-12",
              trigger: "manual",
              ownerId: "153ce5b9-6481-44ee-a82a-d5b065e03bda",
            },
          }),
          replies
        )
      )
    )

    expect(saveIdempotently).not.toHaveBeenCalled()
    expect(JSON.parse(replies[0]!)).toMatchObject({
      protocolVersion: "production.create-job.reply.v1",
      _tag: "Rejected",
      code: "INVALID_REQUEST",
    })
  })

  it("rejects actors that cannot own an episode", async () => {
    const saveIdempotently = vi.fn()
    const replies: string[] = []
    const handler = handleCreateJobRpc({
      nextJobId: Effect.succeed(jobId),
      now: Effect.succeed(now),
      saveIdempotently,
    })

    await Effect.runPromise(
      handler(delivery(envelope({ actor: { _tag: "Anonymous" } }), replies))
    )

    expect(saveIdempotently).not.toHaveBeenCalled()
    expect(JSON.parse(replies[0]!)).toMatchObject({
      _tag: "Rejected",
      code: "UNAUTHENTICATED",
    })
  })

  it("turns malformed JSON into a stable rejection instead of an RPC timeout", async () => {
    const replies: string[] = []
    const handler = handleCreateJobRpc({
      nextJobId: Effect.succeed(jobId),
      now: Effect.succeed(now),
      saveIdempotently: (job) => Effect.succeed(job),
    })

    await Effect.runPromise(
      handler({
        payload: "{not-json",
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    expect(JSON.parse(replies[0]!)).toMatchObject({
      _tag: "Rejected",
      correlationId: null,
      code: "INVALID_REQUEST",
    })
  })
})
