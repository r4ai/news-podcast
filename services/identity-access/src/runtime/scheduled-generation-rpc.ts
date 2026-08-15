import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  MessageEnvelopeSchema,
  matchesPeerPolicy,
  ScheduledGenerationReplySchema,
  parseMessageEnvelope,
  parseScheduledGenerationRequest,
  subjects,
  type MessageEnvelope,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type { DueGenerationSchedule } from "../application/generation-settings.js"

export type ScheduledGenerationRpcDelivery<E = never> = Readonly<{
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, E>
}>
export type ScheduledGenerationRpcOperations = Readonly<{
  readonly findDue: (
    input: unknown
  ) => Effect.Effect<readonly DueGenerationSchedule[], unknown, never>
  readonly completeScheduled: (
    input: unknown
  ) => Effect.Effect<void, unknown, never>
}>
export type ScheduledGenerationRpcDependencies = Readonly<{
  readonly newMessageId: () => string
  readonly now: () => string
}>
type Subject =
  | typeof subjects.identity.discoverDueGenerations
  | typeof subjects.identity.completeScheduledGeneration

const rejected = (
  code: "INVALID_REQUEST" | "UNAUTHENTICATED" | "STORAGE_FAILURE"
) => deepFreeze({ _tag: "Rejected" as const, code })
const correlated = <E>(
  delivery: ScheduledGenerationRpcDelivery<E>,
  request: MessageEnvelope,
  payload: unknown,
  dependencies: ScheduledGenerationRpcDependencies
) =>
  parse(ScheduledGenerationReplySchema)(payload).pipe(
    Effect.flatMap((trusted) =>
      Effect.currentSpan.pipe(
        Effect.flatMap((span) =>
          parse(MessageEnvelopeSchema)({
            messageId: dependencies.newMessageId(),
            correlationId: request.correlationId,
            causationId: request.messageId,
            occurredAt: dependencies.now(),
            producer: "identity-access",
            traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
            actor: { _tag: "Service", service: "identity-access" },
            payload: trusted,
          })
        )
      )
    ),
    Effect.flatMap(Schema.encodeEffect(MessageEnvelopeSchema)),
    Effect.map(JSON.stringify),
    Effect.flatMap(delivery.reply)
  )

/** Internal scheduler boundary, callable only by the Episode Production service. */
export const makeScheduledGenerationRpcHandler =
  (
    subject: Subject,
    operations: ScheduledGenerationRpcOperations,
    dependencies: ScheduledGenerationRpcDependencies
  ) =>
  <E>(delivery: ScheduledGenerationRpcDelivery<E>) =>
    Effect.try({
      try: () => JSON.parse(delivery.payload) as unknown,
      catch: () => undefined,
    }).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.matchEffect({
        onFailure: () =>
          Effect.logWarning("scheduler RPC envelope rejected", {
            subject,
            failure_stage: "transport",
            failure_reason: "invalid_envelope",
          }),
        onSuccess: (request) => {
          const reply = (payload: unknown) =>
            correlated(delivery, request, payload, dependencies)
          const process = !matchesPeerPolicy(request, {
            producer: "episode-production",
            actor: "Service",
            service: "episode-production",
          })
            ? reply(rejected("UNAUTHENTICATED"))
            : parseScheduledGenerationRequest(request.payload).pipe(
                Effect.flatMap(
                  (command): Effect.Effect<unknown, unknown, never> => {
                    if (subject === subjects.identity.discoverDueGenerations) {
                      if (command.operation !== "DiscoverDue")
                        return Effect.fail({
                          _tag: "InvalidRequest" as const,
                        })
                      return operations.findDue({ instant: command.now }).pipe(
                        Effect.map((schedules) => ({
                          _tag: "Due" as const,
                          schedules,
                        }))
                      )
                    }
                    if (command.operation !== "Complete")
                      return Effect.fail({
                        _tag: "InvalidRequest" as const,
                      })
                    return operations
                      .completeScheduled({
                        ownerId: command.ownerId,
                        localDate: command.localDate,
                      })
                      .pipe(Effect.as({ _tag: "Completed" as const }))
                  }
                ),
                Effect.matchEffect({
                  onFailure: (failure) =>
                    reply(
                      rejected(
                        typeof failure === "object" &&
                          failure !== null &&
                          "_tag" in failure &&
                          failure._tag === "GenerationSettingsStoreFailed"
                          ? "STORAGE_FAILURE"
                          : "INVALID_REQUEST"
                      )
                    ),
                  onSuccess: reply,
                })
              )
          return withRemoteTraceparent(
            withMessagingSpan(process, subject, "process"),
            request.traceparent
          )
        },
      })
    )
