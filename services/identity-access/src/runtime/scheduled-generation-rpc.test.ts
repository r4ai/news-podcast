import {
  parseMessageEnvelope,
  parseScheduledGenerationReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { makeScheduledGenerationRpcHandler } from "./scheduled-generation-rpc.js"

const request = (
  actor: unknown,
  payload: unknown,
  producer = "episode-production"
) =>
  JSON.stringify({
    messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
    correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
    causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
    occurredAt: "2026-08-12T00:00:00.000Z",
    producer,
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    actor,
    payload,
  })
const dependencies = {
  newMessageId: () => "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  now: () => "2026-08-12T00:00:01.000Z",
}
const decode = async (value: string) => {
  const envelope = await Effect.runPromise(
    parseMessageEnvelope(JSON.parse(value))
  )
  return {
    envelope,
    payload: await Effect.runPromise(
      parseScheduledGenerationReply(envelope.payload)
    ),
  }
}

describe("scheduled generation RPC", () => {
  it("discovers due schedules for the strict request instant and correlates the reply", async () => {
    const findDue = vi.fn(() =>
      Effect.succeed([{ ownerId: "owner-a" as never, localDate: "2026-08-12" }])
    )
    let encoded = ""
    await Effect.runPromise(
      makeScheduledGenerationRpcHandler(
        subjects.identity.discoverDueGenerations,
        { findDue, completeScheduled: vi.fn() as never },
        dependencies
      )({
        payload: request(
          { _tag: "Service", service: "episode-production" },
          { operation: "DiscoverDue", now: "2026-08-12T00:00:00.000Z" }
        ),
        reply: (payload) => Effect.sync(() => void (encoded = payload)),
      })
    )
    expect(findDue).toHaveBeenCalledWith({
      instant: "2026-08-12T00:00:00.000Z",
    })
    const reply = await decode(encoded)
    expect(reply.envelope).toMatchObject({
      correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
      causationId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
      producer: "identity-access",
    })
    expect(reply.payload).toEqual({
      _tag: "Due",
      schedules: [{ ownerId: "owner-a", localDate: "2026-08-12" }],
    })
  })

  it("allows completion only from the episode-production service actor", async () => {
    const completeScheduled = vi.fn(() => Effect.void)
    const replies: string[] = []
    const handler = makeScheduledGenerationRpcHandler(
      subjects.identity.completeScheduledGeneration,
      { findDue: vi.fn() as never, completeScheduled },
      dependencies
    )
    for (const actor of [
      { _tag: "Service", service: "episode-production" },
      { _tag: "User", userId: "owner-a" },
    ])
      await Effect.runPromise(
        handler({
          payload: request(actor, {
            operation: "Complete",
            ownerId: "owner-a",
            localDate: "2026-08-12",
          }),
          reply: (payload) => Effect.sync(() => void replies.push(payload)),
        })
      )
    expect(completeScheduled).toHaveBeenCalledOnce()
    expect((await decode(replies[0]!)).payload).toEqual({ _tag: "Completed" })
    expect((await decode(replies[1]!)).payload).toEqual({
      _tag: "Rejected",
      code: "UNAUTHENTICATED",
    })
  })

  it("correlates invalid dates, operation mismatches, and storage failures", async () => {
    const payloads: unknown[] = []
    const cases = [
      {
        subject: subjects.identity.discoverDueGenerations,
        command: { operation: "DiscoverDue", now: "not-an-instant" },
        operations: {
          findDue: vi.fn() as never,
          completeScheduled: vi.fn() as never,
        },
      },
      {
        subject: subjects.identity.discoverDueGenerations,
        command: {
          operation: "Complete",
          ownerId: "owner",
          localDate: "2026-08-12",
        },
        operations: {
          findDue: vi.fn() as never,
          completeScheduled: vi.fn() as never,
        },
      },
      {
        subject: subjects.identity.discoverDueGenerations,
        command: { operation: "DiscoverDue", now: "2026-08-12T00:00:00.000Z" },
        operations: {
          findDue: () => Effect.fail({ _tag: "GenerationSettingsStoreFailed" }),
          completeScheduled: vi.fn() as never,
        },
      },
    ] as const
    for (const testCase of cases) {
      let encoded = ""
      await Effect.runPromise(
        makeScheduledGenerationRpcHandler(
          testCase.subject,
          testCase.operations,
          dependencies
        )({
          payload: request(
            { _tag: "Service", service: "episode-production" },
            testCase.command
          ),
          reply: (value) => Effect.sync(() => void (encoded = value)),
        })
      )
      payloads.push((await decode(encoded)).payload)
    }
    expect(payloads).toEqual([
      { _tag: "Rejected", code: "INVALID_REQUEST" },
      { _tag: "Rejected", code: "INVALID_REQUEST" },
      { _tag: "Rejected", code: "STORAGE_FAILURE" },
    ])
  })
})
