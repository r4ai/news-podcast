import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { UnsafeJetStream } from "../../infrastructure/unsafe/nats-jetstream.js"
import type { OutboxPublisher } from "./outbox.js"

export const createJetStreamPublisher = (
  jetStream: UnsafeJetStream
): OutboxPublisher =>
  deepFreeze({
    publish: (message) =>
      Effect.tryPromise({
        try: () =>
          jetStream.publish(
            message.subject,
            message.payload,
            message.messageId
          ),
        catch: () =>
          deepFreeze({
            _tag: "OutboxPublishFailed" as const,
            reason: "Unavailable" as const,
          }),
      }),
  })
