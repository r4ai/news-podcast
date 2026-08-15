import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { UnsafeJetStream } from "../../infrastructure/unsafe/nats-jetstream.js"
import { createJetStreamPublisher } from "./jetstream-publisher.js"
import type { PendingOutboxMessage } from "./outbox.js"

describe("JetStream outbox publisher", () => {
  it("uses the persisted envelope message id as the JetStream deduplication id", async () => {
    const publish = vi.fn(
      async (_subject: string, _payload: string, _messageId: string) =>
        deepFreeze({ stream: "CONTENT_EVENTS", sequence: 1, duplicate: false })
    )
    const jetStream: UnsafeJetStream = deepFreeze({
      publish: (subject, payload, messageId) =>
        publish(subject, payload, messageId),
      close: async () => undefined,
    })
    const message = deepFreeze({
      messageId: "8fb12955-2175-4675-be63-e42227d5ed19",
      subject: "content.article-archived.v1",
      payload: "serialized-envelope",
      envelope: {},
    }) as unknown as PendingOutboxMessage

    await Effect.runPromise(
      createJetStreamPublisher(jetStream).publish(message)
    )

    expect(publish).toHaveBeenCalledWith(
      "content.article-archived.v1",
      "serialized-envelope",
      "8fb12955-2175-4675-be63-e42227d5ed19"
    )
  })
})
