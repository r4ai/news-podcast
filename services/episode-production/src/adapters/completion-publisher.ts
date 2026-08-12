import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { CompletionOutboxPorts } from "../application/completion-outbox.js"
import type { UnsafeProductionJetStream } from "../infrastructure/unsafe/nats-jetstream.js"

export const makeCompletionPublisher = (
  jetStream: UnsafeProductionJetStream
): CompletionOutboxPorts["publish"] =>
  (message) =>
    Effect.tryPromise({
      try: () =>
        jetStream.publish(message.subject, message.payload, message.messageId),
      catch: () =>
        deepFreeze({
          _tag: "PipelineFailure" as const,
          code: "nats_completion_publish",
          retryable: true,
        }),
    })
