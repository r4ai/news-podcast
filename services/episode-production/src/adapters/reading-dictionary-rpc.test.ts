import {
  parseMessageEnvelope,
  parseReadingDictionaryReply,
} from "@news-podcast/protocols"
import { DateTime, Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { ReadingDictionaryRepository } from "../application/reading-dictionary.js"
import { ReadingDictionaryEntrySchema } from "../domain/reading-dictionary.js"
import { makeReadingDictionaryRpcHandler } from "./reading-dictionary-rpc.js"

const now = () => DateTime.makeUnsafe(new Date("2026-08-12T00:00:01.000Z"))
const entry = Schema.decodeUnknownSync(ReadingDictionaryEntrySchema)({
  id: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  ownerId: "owner-a",
  surface: "NHK",
  reading: "エヌエイチケー",
  accentType: 0,
  source: "manual",
  episodeJobId: null,
  createdAt: "2026-08-12T00:00:01.000Z",
  updatedAt: "2026-08-12T00:00:01.000Z",
})
const request = (actor: unknown, payload: unknown) =>
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
const repository = (): ReadingDictionaryRepository => ({
  create: vi.fn(() => Effect.succeed({ _tag: "Created" as const, entry })),
  list: vi.fn(() => Effect.succeed([entry])),
  update: vi.fn(() => Effect.succeed({ _tag: "Updated" as const, entry })),
  remove: vi.fn(() => Effect.succeed({ _tag: "Deleted" as const })),
  captureSnapshot: vi.fn() as never,
})
const dependencies = {
  newId: () => entry.id,
  newMessageId: () => "10e2d4e1-c127-479f-a124-2ea037bd9319",
  now,
}

describe("reading dictionary RPC", () => {
  it("lists only the Actor owner and omits ownership from the public wire entry", async () => {
    const store = repository()
    let encoded = ""
    await Effect.runPromise(
      makeReadingDictionaryRpcHandler(
        store,
        dependencies
      )({
        payload: request(
          { _tag: "User", userId: "owner-a" },
          { operation: "List" }
        ),
        reply: (payload) => Effect.sync(() => void (encoded = payload)),
      })
    )

    expect(store.list).toHaveBeenCalledWith("owner-a")
    const envelope = await Effect.runPromise(
      parseMessageEnvelope(JSON.parse(encoded))
    )
    expect(envelope).toMatchObject({
      correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
      causationId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
      producer: "episode-production",
    })
    const reply = await Effect.runPromise(
      parseReadingDictionaryReply(envelope.payload)
    )
    expect(reply).toMatchObject({ _tag: "Entries" })
    expect(JSON.stringify(reply)).not.toContain("ownerId")
  })

  it("correlates unauthenticated and invalid request payloads", async () => {
    const replies: string[] = []
    const handler = makeReadingDictionaryRpcHandler(repository(), dependencies)
    for (const [actor, payload] of [
      [{ _tag: "Anonymous" }, { operation: "List" }],
      [
        { _tag: "User", userId: "owner-a" },
        { operation: "Delete", id: "not-a-uuid" },
      ],
    ] as const) {
      await Effect.runPromise(
        handler({
          payload: request(actor, payload),
          reply: (value) => Effect.sync(() => void replies.push(value)),
        })
      )
    }
    const decoded = await Promise.all(
      replies.map(async (value) => {
        const envelope = await Effect.runPromise(
          parseMessageEnvelope(JSON.parse(value))
        )
        return Effect.runPromise(parseReadingDictionaryReply(envelope.payload))
      })
    )
    expect(decoded).toEqual([
      { _tag: "Rejected", code: "UNAUTHENTICATED" },
      { _tag: "Rejected", code: "INVALID_REQUEST" },
    ])
  })
})
