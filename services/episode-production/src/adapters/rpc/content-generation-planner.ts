import { deepFreeze, parse } from "@news-podcast/kernel"
import type { EpisodeFailureCode } from "@news-podcast/contracts/episode-failure"
import {
  PlanGenerationReplySchema,
  messageEnvelope,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type {
  EpisodeExecutionPorts,
  PipelineFailure,
} from "../../application/ports/execution.js"
import { GenerationPlanSchema } from "../../domain/generation-plan.js"
import type { UnsafeNatsRequestClient } from "../../infrastructure/unsafe/nats-request.js"

const decodeReplyEnvelope = Schema.decodeUnknownEffect(
  messageEnvelope(PlanGenerationReplySchema),
  { errors: "all", onExcessProperty: "error" }
)

const failure = (
  code:
    | Extract<EpisodeFailureCode, `generation_planning_${string}`>
    | "no_generation_candidates",
  retryable: boolean
): PipelineFailure => deepFreeze({ _tag: "PipelineFailure", code, retryable })

const rejectionFailureCodes = {
  INVALID_REQUEST: "generation_planning_invalid_request",
  UNAUTHENTICATED: "generation_planning_unauthenticated",
  NOT_FOUND: "generation_planning_not_found",
  STORAGE_FAILURE: "generation_planning_storage_failure",
  OBJECT_FAILURE: "generation_planning_object_failure",
  INTERNAL_ERROR: "generation_planning_internal_error",
} as const

/** Fetches current preferences and candidate selection; persistence freezes the winner. */
export const makeContentGenerationPlanner = (
  client: UnsafeNatsRequestClient,
  dependencies: {
    readonly newMessageId: () => string
    readonly now: () => string
    readonly timeoutMillis: number
  }
): EpisodeExecutionPorts["planning"] =>
  deepFreeze({
    create: (input) => {
      const messageId = dependencies.newMessageId()
      return Effect.currentSpan.pipe(
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
        Effect.orDie,
        Effect.flatMap((envelope) =>
          Effect.tryPromise({
            try: () =>
              client.request(
                subjects.content.planGeneration,
                new TextEncoder().encode(JSON.stringify(envelope)),
                dependencies.timeoutMillis,
                input.signal
              ),
            catch: () =>
              input.signal?.aborted
                ? failure("generation_planning_canceled", false)
                : failure("generation_planning_unavailable", true),
          })
        ),
        Effect.flatMap((bytes) =>
          Effect.try({
            try: () => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
            catch: () => failure("generation_planning_invalid_reply", true),
          })
        ),
        Effect.flatMap(decodeReplyEnvelope),
        Effect.mapError(() =>
          failure("generation_planning_invalid_reply", true)
        ),
        Effect.flatMap((reply) => {
          if (reply.correlationId !== messageId) {
            return Effect.fail(
              failure("generation_planning_correlation_mismatch", true)
            )
          }
          if (reply.payload._tag === "NoCandidates") {
            return Effect.fail(failure("no_generation_candidates", false))
          }
          if (reply.payload._tag === "Rejected") {
            return Effect.fail(
              failure(
                rejectionFailureCodes[reply.payload.code],
                reply.payload.code === "INTERNAL_ERROR" ||
                  reply.payload.code === "STORAGE_FAILURE"
              )
            )
          }
          return parse(GenerationPlanSchema)({
            jobId: input.jobId,
            ownerId: input.ownerId,
            selectionMode:
              input.selection._tag === "Automatic" ? "automatic" : "manual",
            interestProfile: reply.payload.plan.interestProfile,
            selectedArticleIds: reply.payload.plan.selectedArticleIds,
            model: reply.payload.plan.model,
            createdAt: dependencies.now(),
          }).pipe(
            Effect.mapError(() =>
              failure("generation_planning_invalid_reply", true)
            )
          )
        })
      )
    },
  })
