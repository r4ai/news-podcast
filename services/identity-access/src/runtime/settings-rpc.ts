import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  IdentitySettingsReplySchema,
  MessageEnvelopeSchema,
  parseIdentitySettingsRequest,
  parseMessageEnvelope,
  subjects,
  type MessageEnvelope,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import { UserIdSchema } from "../domain/actor.js"
import type { GenerationSchedule } from "../domain/generation-settings.js"

export type IdentitySettingsRpcDelivery<ReplyError = never> = Readonly<{
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, ReplyError>
}>

export type IdentitySettingsRpcDependencies = Readonly<{
  readonly newMessageId: () => string
  readonly now: () => string
}>

export type IdentitySettingsRpcOperations = Readonly<{
  readonly get: (
    input: unknown
  ) => Effect.Effect<GenerationSchedule, unknown, never>
  readonly update: (
    input: unknown
  ) => Effect.Effect<GenerationSchedule, unknown, never>
}>
type SettingsSubject =
  | typeof subjects.identity.getGenerationSettings
  | typeof subjects.identity.updateGenerationSettings

const rejected = (
  code: "INVALID_REQUEST" | "UNAUTHENTICATED" | "STORAGE_FAILURE"
) => deepFreeze({ _tag: "Rejected" as const, code })

const rawInvalid = <E>(delivery: IdentitySettingsRpcDelivery<E>) =>
  delivery.reply(JSON.stringify(rejected("INVALID_REQUEST")))

const correlated = <E>(
  delivery: IdentitySettingsRpcDelivery<E>,
  request: MessageEnvelope,
  payload: unknown,
  dependencies: IdentitySettingsRpcDependencies
) =>
  parse(IdentitySettingsReplySchema)(payload).pipe(
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

/** Authenticated, owner-scoped settings RPC. The request payload cannot select an owner. */
export const makeIdentitySettingsRpcHandler =
  (
    subject: SettingsSubject,
    operations: IdentitySettingsRpcOperations,
    dependencies: IdentitySettingsRpcDependencies
  ) =>
  <E>(delivery: IdentitySettingsRpcDelivery<E>) =>
    Effect.try({
      try: () => JSON.parse(delivery.payload) as unknown,
      catch: () => undefined,
    }).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.matchEffect({
        onFailure: () => rawInvalid(delivery),
        onSuccess: (request) => {
          const reply = (payload: unknown) =>
            correlated(delivery, request, payload, dependencies)
          const process =
            request.producer !== "gateway"
              ? reply(rejected("INVALID_REQUEST"))
              : request.actor._tag !== "User"
                ? reply(rejected("UNAUTHENTICATED"))
                : Effect.all([
                    parse(UserIdSchema)(request.actor.userId),
                    parseIdentitySettingsRequest(request.payload),
                  ]).pipe(
                    Effect.flatMap(
                      ([ownerId, command]): Effect.Effect<unknown, unknown> => {
                        if (
                          (subject ===
                            subjects.identity.getGenerationSettings &&
                            command.operation !== "Get") ||
                          (subject ===
                            subjects.identity.updateGenerationSettings &&
                            command.operation !== "Update")
                        )
                          return Effect.fail({
                            _tag: "InvalidRequest" as const,
                          })

                        return command.operation === "Get"
                          ? operations.get({ ownerId })
                          : operations.update({
                              ownerId,
                              generationSchedule: command.generationSchedule,
                            })
                      }
                    ),
                    Effect.map((generationSchedule) => ({
                      _tag: "Settings" as const,
                      generationSchedule,
                    })),
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
