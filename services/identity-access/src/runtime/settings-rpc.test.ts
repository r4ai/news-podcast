import {
  parseIdentitySettingsReply,
  parseMessageEnvelope,
  subjects,
} from "@news-podcast/protocols"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { makeIdentitySettingsRpcHandler } from "./settings-rpc.js"

const envelope = (actor: unknown, payload: unknown) =>
  JSON.stringify({
    messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
    correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
    causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
    occurredAt: "2026-08-12T00:00:00.000Z",
    producer: "gateway",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    actor,
    payload,
  })

const dependencies = {
  newMessageId: () => "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  now: () => "2026-08-12T00:00:01.000Z",
}

describe("Identity settings RPC", () => {
  it("derives owner from Actor and returns a correlated service envelope", async () => {
    const get = vi.fn(() =>
      Effect.succeed({
        enabled: true,
        localTime: "08:15" as never,
        timeZone: "Asia/Tokyo" as never,
      })
    )
    const replies: string[] = []
    const handler = makeIdentitySettingsRpcHandler(
      subjects.identity.getGenerationSettings,
      { get, update: vi.fn() as never },
      dependencies
    )

    await Effect.runPromise(
      handler({
        payload: envelope(
          { _tag: "User", userId: "owner-from-actor" },
          { operation: "Get" }
        ),
        reply: (payload) => Effect.sync(() => void replies.push(payload)),
      })
    )

    expect(get).toHaveBeenCalledWith({ ownerId: "owner-from-actor" })
    const reply = await Effect.runPromise(
      parseMessageEnvelope(JSON.parse(replies[0]!))
    )
    expect(reply).toMatchObject({
      correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
      causationId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
      producer: "identity-access",
      actor: { _tag: "Service", service: "identity-access" },
    })
    await expect(
      Effect.runPromise(parseIdentitySettingsReply(reply.payload))
    ).resolves.toMatchObject({ _tag: "Settings" })
  })

  it("correlates authentication and valid-envelope validation failures", async () => {
    const replies: string[] = []
    const handler = makeIdentitySettingsRpcHandler(
      subjects.identity.updateGenerationSettings,
      { get: vi.fn() as never, update: vi.fn() as never },
      dependencies
    )
    for (const [actor, payload] of [
      [{ _tag: "Anonymous" }, { operation: "Update" }],
      [{ _tag: "User", userId: "owner" }, { operation: "Get" }],
    ] as const) {
      await Effect.runPromise(
        handler({
          payload: envelope(actor, payload),
          reply: (reply) => Effect.sync(() => void replies.push(reply)),
        })
      )
    }

    const payloads = await Promise.all(
      replies.map(async (value) => {
        const reply = await Effect.runPromise(
          parseMessageEnvelope(JSON.parse(value))
        )
        return Effect.runPromise(parseIdentitySettingsReply(reply.payload))
      })
    )
    expect(payloads).toEqual([
      { _tag: "Rejected", code: "UNAUTHENTICATED" },
      { _tag: "Rejected", code: "INVALID_REQUEST" },
    ])
  })

  it("does not reply when no request envelope exists", async () => {
    let reply = ""
    await Effect.runPromise(
      makeIdentitySettingsRpcHandler(
        subjects.identity.getGenerationSettings,
        { get: vi.fn() as never, update: vi.fn() as never },
        dependencies
      )({
        payload: "not-json",
        reply: (payload) => Effect.sync(() => void (reply = payload)),
      })
    )
    expect(reply).toBe("")
  })
})
