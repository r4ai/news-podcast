import { deepFreeze } from "@news-podcast/kernel"
import {
  MaterializeArticlesReplySchema,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type {
  EpisodeExecutionPorts,
  PipelineFailure,
} from "../application/execution-ports.js"
import type { UnsafeNatsRequestClient } from "../infrastructure/unsafe/nats-request.js"

const decodeReply = Schema.decodeUnknownEffect(MaterializeArticlesReplySchema, {
  errors: "all",
  onExcessProperty: "error",
})

const failure = (code: string, retryable: boolean): PipelineFailure =>
  deepFreeze({ _tag: "PipelineFailure" as const, code, retryable })

/** Owner scope is carried exclusively by the authenticated message actor. */
export const makeContentArticleMaterializer = (
  client: UnsafeNatsRequestClient,
  dependencies: {
    newMessageId: () => string
    now: () => string
    timeoutMillis: number
  }
): EpisodeExecutionPorts["articles"] =>
  deepFreeze({
    materialize: (input) => {
      const messageId = dependencies.newMessageId()
      const request = Effect.currentSpan.pipe(
        Effect.map((span) => ({
          messageId,
          correlationId: messageId,
          causationId: messageId,
          occurredAt: dependencies.now(),
          producer: "episode-production",
          traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
          actor: { _tag: "User", userId: input.ownerId },
          payload: { selection: input.selection },
        })),
        Effect.orDie
      )
      return request.pipe(
        Effect.flatMap((envelope) =>
          Effect.tryPromise({
            try: () =>
              client.request(
                subjects.content.materializeArticles,
                new TextEncoder().encode(JSON.stringify(envelope)),
                dependencies.timeoutMillis,
                input.signal
              ),
            catch: () =>
              input.signal?.aborted
                ? failure("content_materialization_canceled", false)
                : failure("content_materialization_unavailable", true),
          })
        ),
        Effect.flatMap((bytes) =>
          Effect.try({
            try: () => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
            catch: () => failure("content_materialization_invalid", false),
          })
        ),
        Effect.flatMap(decodeReply),
        Effect.mapError((error) =>
          "_tag" in error && error._tag === "PipelineFailure"
            ? error
            : failure("content_materialization_invalid", false)
        ),
        Effect.flatMap((reply) => {
          if (reply._tag === "Materialized") {
            return Effect.succeed(
              deepFreeze(reply.articles) as unknown as readonly [
                (typeof reply.articles)[number],
                ...(typeof reply.articles)[number][],
              ]
            )
          }
          return Effect.fail(
            failure(
              reply._tag === "Rejected" && reply.code === "STORAGE_FAILURE"
                ? "content_materialization_unavailable"
                : "content_materialization_empty",
              reply._tag === "Rejected" && reply.code === "STORAGE_FAILURE"
            )
          )
        }),
        Effect.withSpan("episodeProduction.materializeArticles")
      )
    },
  })
