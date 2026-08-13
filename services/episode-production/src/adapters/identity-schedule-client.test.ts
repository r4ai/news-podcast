import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { makeIdentityScheduleClient } from "./identity-schedule-client.js"

const encoder = new TextEncoder()
const instant = "2026-08-13T00:00:00.000Z"
const id = "10e2d4e1-c127-479f-a124-2ea037bd9319"
const reply = (correlationId = id) =>
  encoder.encode(
    JSON.stringify({
      messageId: "20e2d4e1-c127-479f-a124-2ea037bd9319",
      correlationId,
      causationId: id,
      occurredAt: instant,
      producer: "identity-access",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      actor: { _tag: "Service", service: "identity-access" },
      payload: {
        _tag: "Due",
        schedules: [{ ownerId: "owner-1", localDate: "2026-08-13" }],
      },
    })
  )

describe("Identity schedule client", () => {
  it("accepts a correlated bounded due reply", async () => {
    const client = makeIdentityScheduleClient(
      { request: async () => reply(), close: async () => undefined },
      { now: () => instant, timeoutMillis: 100, newMessageId: () => id }
    )
    await expect(
      Effect.runPromise(client.discoverDue().pipe(Effect.withSpan("test")))
    ).resolves.toEqual([{ ownerId: "owner-1", localDate: "2026-08-13" }])
  })

  it("rejects a reply from another request lineage", async () => {
    const client = makeIdentityScheduleClient(
      {
        request: async () => reply("30e2d4e1-c127-479f-a124-2ea037bd9319"),
        close: async () => undefined,
      },
      { now: () => instant, timeoutMillis: 100, newMessageId: () => id }
    )
    const exit = await Effect.runPromiseExit(
      client.discoverDue().pipe(Effect.withSpan("test"))
    )
    expect(exit._tag).toBe("Failure")
  })
})
