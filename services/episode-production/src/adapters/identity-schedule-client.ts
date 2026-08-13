import { randomUUID } from "node:crypto"

import { deepFreeze } from "@news-podcast/kernel"
import {
  MessageEnvelopeSchema,
  ScheduledGenerationReplySchema,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type { UnsafeNatsRequestClient } from "../infrastructure/unsafe/nats-request.js"

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const decodeEnvelope = Schema.decodeUnknownEffect(MessageEnvelopeSchema, {
  errors: "all",
  onExcessProperty: "error",
})
const decodeReply = Schema.decodeUnknownEffect(ScheduledGenerationReplySchema, {
  errors: "all",
  onExcessProperty: "error",
})
const failed = () =>
  deepFreeze({ _tag: "ScheduledGenerationRpcFailed" as const })

export const makeIdentityScheduleClient = (
  client: UnsafeNatsRequestClient,
  dependencies: {
    now: () => string
    timeoutMillis: number
    newMessageId?: () => string
  }
) => {
  const request = (subject: string, payload: unknown) =>
    Effect.currentSpan.pipe(
      Effect.flatMap((span) => {
        const messageId = (dependencies.newMessageId ?? randomUUID)()
        return Effect.tryPromise({
          try: () =>
            client.request(
              subject,
              encoder.encode(
                JSON.stringify({
                  messageId,
                  correlationId: messageId,
                  causationId: messageId,
                  occurredAt: dependencies.now(),
                  producer: "episode-production",
                  traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
                  actor: { _tag: "Service", service: "episode-production" },
                  payload,
                })
              ),
              dependencies.timeoutMillis
            ),
          catch: failed,
        }).pipe(Effect.map((bytes) => ({ bytes, messageId })))
      }),
      Effect.flatMap(({ bytes, messageId }) =>
        Effect.try({
          try: () => ({
            value: JSON.parse(decoder.decode(bytes)) as unknown,
            messageId,
          }),
          catch: failed,
        })
      ),
      Effect.flatMap(({ value, messageId }) =>
        decodeEnvelope(value).pipe(
          Effect.filterOrFail(
            (reply) =>
              reply.correlationId === messageId &&
              reply.causationId === messageId,
            failed
          )
        )
      ),
      Effect.flatMap((envelope) => decodeReply(envelope.payload)),
      Effect.mapError(failed)
    )

  return deepFreeze({
    discoverDue: () =>
      request(subjects.identity.discoverDueGenerations, {
        operation: "DiscoverDue",
        now: dependencies.now(),
      }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Due"
            ? Effect.succeed(reply.schedules)
            : Effect.fail(failed())
        )
      ),
    complete: (ownerId: string, localDate: string) =>
      request(subjects.identity.completeScheduledGeneration, {
        operation: "Complete",
        ownerId,
        localDate,
      }).pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Completed" ? Effect.void : Effect.fail(failed())
        )
      ),
  })
}
