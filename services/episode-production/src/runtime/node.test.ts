import { subjects } from "@news-podcast/protocols"
import { Effect, Fiber, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { UnsafeNatsRpcServer } from "../infrastructure/unsafe/nats-rpc.js"
import { UtcTimestampSchema } from "../domain/episode-job.js"
import { runNodeCreateJobRpc, runNodeProductionRpc } from "./node.js"

const config = {
  sqlitePath: ":memory:",
  natsServers: ["nats://127.0.0.1:4222"],
  queueGroup: "episode-production",
}

describe("episode-production Node RPC runtime", () => {
  it("acquires NATS in scope, processes sequentially, and drains it", async () => {
    const replies: string[] = []
    const drain = vi.fn(async () => undefined)
    const pending = [
      {
        payload: JSON.stringify({
          messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
          correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
          causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
          occurredAt: "2026-08-12T00:00:00.000Z",
          producer: "gateway",
          traceparent:
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          actor: {
            _tag: "User",
            userId: "d25da30b-4cd1-4875-94c7-6d48f32b5b1c",
          },
          payload: {
            idempotencyKey: "daily-2026-08-12",
            trigger: "manual",
          },
        }),
        reply: async (payload: string) => void replies.push(payload),
      },
    ]
    const server: UnsafeNatsRpcServer = {
      receive: async () => pending.shift(),
      drain,
    }

    await Effect.runPromise(
      runNodeCreateJobRpc(config, {
        connectNats: vi.fn(async () => server),
        newJobId: () => "10e2d4e1-c127-479f-a124-2ea037bd9319" as never,
        now: () =>
          Schema.decodeUnknownSync(UtcTimestampSchema)(
            "2026-08-12T00:00:00.000Z"
          ),
      })
    )

    expect(JSON.parse(replies[0]!)).toMatchObject({ _tag: "Accepted" })
    expect(drain).toHaveBeenCalledOnce()
  })

  it("rejects invalid configuration before connecting", async () => {
    const connectNats = vi.fn()

    const exit = await Effect.runPromiseExit(
      runNodeCreateJobRpc(
        { ...config, natsServers: ["https://not-nats.example.com"] },
        {
          connectNats,
          newJobId: () => "unused" as never,
          now: () => "unused" as never,
        }
      )
    )

    expect(exit._tag).toBe("Failure")
    expect(connectNats).not.toHaveBeenCalled()
  })

  it("drains NATS when the process fiber is interrupted", async () => {
    const drain = vi.fn(async () => undefined)
    let resolveConnected!: () => void
    const connected = new Promise<void>((resolve) => {
      resolveConnected = resolve
    })
    const server: UnsafeNatsRpcServer = {
      receive: () => new Promise(() => undefined),
      drain,
    }
    const fiber = Effect.runFork(
      runNodeCreateJobRpc(config, {
        connectNats: async () => {
          resolveConnected()
          return server
        },
        newJobId: () => "10e2d4e1-c127-479f-a124-2ea037bd9319" as never,
        now: () =>
          Schema.decodeUnknownSync(UtcTimestampSchema)(
            "2026-08-12T00:00:00.000Z"
          ),
      })
    )

    await connected
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(drain).toHaveBeenCalledOnce()
  })

  it("acquires and drains every versioned job-control subject", async () => {
    const connected: string[] = []
    const drained: string[] = []

    await Effect.runPromise(
      runNodeProductionRpc(config, {
        connectNats: async (_servers, subject) => {
          connected.push(subject)
          return {
            receive: async () => undefined,
            drain: async () => void drained.push(subject),
          }
        },
        newJobId: () => "10e2d4e1-c127-479f-a124-2ea037bd9319" as never,
        now: () =>
          Schema.decodeUnknownSync(UtcTimestampSchema)(
            "2026-08-12T00:00:00.000Z"
          ),
      })
    )

    const expected = [
      subjects.production.createJob,
      subjects.production.getJob,
      subjects.production.listJobs,
      subjects.production.listJobEvents,
      subjects.production.cancelJob,
      subjects.production.retryJob,
    ]
    expect(connected.sort()).toEqual([...expected].sort())
    expect(drained.sort()).toEqual([...expected].sort())
  })
})
