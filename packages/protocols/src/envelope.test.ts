import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { parseMessageEnvelope } from "./envelope.js"

const validEnvelope = {
  messageId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
  causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
  occurredAt: "2026-08-12T00:00:00.000Z",
  producer: "content-knowledge",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  actor: { _tag: "Service", service: "content-knowledge" },
  payload: { articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d" },
}

describe("MessageEnvelope", () => {
  it("parses a correlated message and freezes its payload", async () => {
    const parsed = await Effect.runPromise(parseMessageEnvelope(validEnvelope))

    expect(parsed.producer).toBe("content-knowledge")
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.actor)).toBe(true)
    expect(Object.isFrozen(parsed.payload)).toBe(true)
  })

  it.each([
    ["invalid message UUID", { ...validEnvelope, messageId: "message-1" }],
    ["invalid W3C trace context", { ...validEnvelope, traceparent: "invalid" }],
    ["unknown actor state", { ...validEnvelope, actor: { _tag: "Admin" } }],
    ["invalid UTC timestamp", { ...validEnvelope, occurredAt: "today" }],
  ])("rejects %s", async (_case, input) => {
    const exit = await Effect.runPromiseExit(parseMessageEnvelope(input))

    expect(exit._tag).toBe("Failure")
  })
})
