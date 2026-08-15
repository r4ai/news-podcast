import {
  MessageEnvelopeSchema,
  parseMessageEnvelope,
  parseResolveSessionReply,
} from "@news-podcast/protocols"
import { Effect, Option, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { SessionReader } from "../application/ports/session-reader.js"
import { authenticatedActor, parseUserId } from "../domain/actor.js"
import { makeResolveSessionRpcHandler } from "./resolve-session-rpc.js"

const requestTraceparent =
  "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
const requestMessageId = "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80"
const correlationId = "f8f15e30-6877-4b4d-9568-76bfa3dc3e40"
const replyMessageId = "3c4d046c-b47b-4047-a562-66ac7e74e995"
const userId = "better-auth-user_01"

const envelope = (overrides: Record<string, unknown> = {}) => ({
  messageId: requestMessageId,
  correlationId,
  causationId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  occurredAt: "2026-08-12T00:00:00.000Z",
  producer: "gateway",
  traceparent: requestTraceparent,
  actor: { _tag: "Anonymous" },
  payload: { headers: [{ name: "cookie", value: "session=opaque" }] },
  ...overrides,
})

const delivery = (payload: unknown, replies: string[]) => ({
  payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  reply: (reply: string) =>
    Effect.sync(() => {
      replies.push(reply)
    }),
})

const dependencies = {
  newMessageId: () => replyMessageId,
  now: () => "2026-08-12T00:00:01.000Z",
}

const decodeReplyEnvelope = async (reply: string) => {
  const parsed = await Effect.runPromise(
    parseMessageEnvelope(JSON.parse(reply) as unknown)
  )
  const payload = await Effect.runPromise(
    parseResolveSessionReply(parsed.payload)
  )
  return { parsed, payload }
}

describe("resolve-session NATS RPC", () => {
  it("resolves a user into a traced reply envelope with verified lineage", async () => {
    const parsedUserId = await Effect.runPromise(parseUserId(userId))
    const findAuthenticatedActor = vi.fn(() =>
      Effect.succeed(Option.some(authenticatedActor(parsedUserId)))
    )
    const replies: string[] = []
    const handler = makeResolveSessionRpcHandler(
      { findAuthenticatedActor },
      dependencies
    )

    await Effect.runPromise(handler(delivery(envelope(), replies)))

    expect(findAuthenticatedActor).toHaveBeenCalledWith({
      headers: [{ name: "cookie", value: "session=opaque" }],
    })
    const reply = await decodeReplyEnvelope(replies[0]!)
    expect(reply.payload).toEqual({ actor: { _tag: "User", userId } })
    expect(reply.parsed).toMatchObject({
      messageId: replyMessageId,
      correlationId,
      causationId: requestMessageId,
      producer: "identity-access",
      actor: { _tag: "Service", service: "identity-access" },
    })
    expect(
      Schema.encodeSync(MessageEnvelopeSchema)(reply.parsed).traceparent
    ).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[\da-f]{16}-01$/)
  })

  it("returns the anonymous actor when Better Auth has no session", async () => {
    const replies: string[] = []
    const handler = makeResolveSessionRpcHandler(
      { findAuthenticatedActor: () => Effect.succeed(Option.none()) },
      dependencies
    )

    await Effect.runPromise(handler(delivery(envelope(), replies)))

    expect((await decodeReplyEnvelope(replies[0]!)).payload).toEqual({
      actor: { _tag: "Anonymous" },
    })
  })

  it.each([
    ["wrong producer", { producer: "episode-production" }],
    [
      "non-anonymous caller",
      { actor: { _tag: "Service", service: "gateway" } },
    ],
    ["invalid payload", { payload: { headers: {}, debug: true } }],
  ])("rejects %s without consulting Better Auth", async (_case, override) => {
    const replies: string[] = []
    const findAuthenticatedActor =
      vi.fn<SessionReader["findAuthenticatedActor"]>()
    const handler = makeResolveSessionRpcHandler(
      { findAuthenticatedActor },
      dependencies
    )

    await Effect.runPromise(handler(delivery(envelope(override), replies)))

    expect(findAuthenticatedActor).not.toHaveBeenCalled()
    expect((await decodeReplyEnvelope(replies[0]!)).payload).toEqual({
      _tag: "Rejected",
      code: "INVALID_REQUEST",
    })
  })

  it("does not reply to malformed JSON without envelope lineage", async () => {
    const replies: string[] = []
    const findAuthenticatedActor =
      vi.fn<SessionReader["findAuthenticatedActor"]>()
    const handler = makeResolveSessionRpcHandler(
      { findAuthenticatedActor },
      dependencies
    )

    await Effect.runPromise(handler(delivery("{not-json", replies)))

    expect(findAuthenticatedActor).not.toHaveBeenCalled()
    expect(replies).toEqual([])
  })

  it("converts session-provider failures into stable replies", async () => {
    const providerFailureReplies: string[] = []
    const providerFailure = makeResolveSessionRpcHandler(
      {
        findAuthenticatedActor: () =>
          Effect.fail({
            _tag: "SessionProviderUnavailable",
            message: "database unavailable",
          }),
      },
      dependencies
    )
    await Effect.runPromise(
      providerFailure(delivery(envelope(), providerFailureReplies))
    )

    expect(
      (await decodeReplyEnvelope(providerFailureReplies[0]!)).payload
    ).toEqual({
      _tag: "Rejected",
      code: "SESSION_PROVIDER_FAILURE",
    })
  })

  it("propagates reply transport failures", async () => {
    const handler = makeResolveSessionRpcHandler(
      { findAuthenticatedActor: () => Effect.succeed(Option.none()) },
      dependencies
    )

    const exit = await Effect.runPromiseExit(
      handler({
        payload: JSON.stringify(envelope()),
        reply: () => Effect.fail("reply-failed" as const),
      })
    )

    expect(exit._tag).toBe("Failure")
  })
})
