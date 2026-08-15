import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { makeCompletionPublisher } from "./completion-publisher.js"
import type { UnsafeProductionJetStream } from "../../infrastructure/unsafe/nats-jetstream.js"

const message = {
  subject: "production.job-completed.v2" as const,
  messageId: "10e2d4e1-c127-479f-a124-2ea037bd9319" as never,
  payload: "{}",
}

describe("completion publisher", () => {
  it("uses the durable outbox ID as the JetStream dedupe ID", async () => {
    const publish = vi.fn(async () => ({ duplicate: true }))
    const client = {
      publish,
      close: async () => undefined,
    } as UnsafeProductionJetStream
    const result = await Effect.runPromise(
      makeCompletionPublisher(client)(message)
    )
    expect(result.duplicate).toBe(true)
    expect(publish).toHaveBeenCalledWith(
      message.subject,
      message.payload,
      message.messageId
    )
  })

  it("redacts SDK failures", async () => {
    const client = {
      publish: async () => Promise.reject(new Error("secret broker detail")),
      close: async () => undefined,
    } as UnsafeProductionJetStream
    const exit = await Effect.runPromiseExit(
      makeCompletionPublisher(client)(message)
    )
    expect(exit._tag).toBe("Failure")
    expect(JSON.stringify(exit)).not.toContain("secret")
  })
})
