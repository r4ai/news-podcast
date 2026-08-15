import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  MessageEnvelopeSchema,
  matchesPeerPolicy,
  ResolveSessionResponseSchema,
  parseMessageEnvelope,
  parseResolveSessionRequest,
  subjects,
  type MessageEnvelope,
  type ResolveSessionRejection,
  type ResolveSessionReply,
  type ResolveSessionRequest,
} from "@news-podcast/protocols"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import { Effect, Schema } from "effect"

import type { SessionReader } from "../application/ports/session-reader.js"
import type { Actor } from "../domain/actor.js"
import { makeResolveSessionHandler } from "./resolve-session-handler.js"

export type ResolveSessionRpcDelivery<ReplyError = never> = Readonly<{
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, ReplyError>
}>

export type ResolveSessionRpcDependencies = Readonly<{
  readonly newMessageId: () => string
  readonly now: () => string
}>

export type ResolveSessionRpcFailure = Readonly<{
  readonly _tag: "ResolveSessionRpcFailure"
  readonly operation: "encode-reply-envelope"
}>

type ValidRequestEnvelope = MessageEnvelope &
  Readonly<{ payload: ResolveSessionRequest }>

const parseReplyEnvelope = parse(MessageEnvelopeSchema)
const invalidRequest = (): ResolveSessionRejection =>
  deepFreeze({ _tag: "Rejected" as const, code: "INVALID_REQUEST" as const })
const providerFailure = (): ResolveSessionRejection =>
  deepFreeze({
    _tag: "Rejected" as const,
    code: "SESSION_PROVIDER_FAILURE" as const,
  })
const replyEnvelopeFailure = (): ResolveSessionRpcFailure =>
  deepFreeze({
    _tag: "ResolveSessionRpcFailure" as const,
    operation: "encode-reply-envelope" as const,
  })

const decodeJson = (payload: string) =>
  Effect.try({
    try: (): unknown => JSON.parse(payload),
    catch: invalidRequest,
  })

const verifyRequest = (
  envelope: MessageEnvelope
): Effect.Effect<ValidRequestEnvelope, ResolveSessionRejection> => {
  if (
    !matchesPeerPolicy(envelope, {
      producer: "gateway",
      actor: "Anonymous",
    })
  ) {
    return Effect.fail(invalidRequest())
  }
  return parseResolveSessionRequest(envelope.payload).pipe(
    Effect.mapError(invalidRequest),
    Effect.map((payload) => deepFreeze({ ...envelope, payload }))
  )
}

const replyEnvelope = <ReplyError>(
  delivery: ResolveSessionRpcDelivery<ReplyError>,
  request: MessageEnvelope,
  payload: ResolveSessionReply,
  dependencies: ResolveSessionRpcDependencies
) =>
  Effect.currentSpan.pipe(
    Effect.flatMap((span) =>
      parseReplyEnvelope({
        messageId: dependencies.newMessageId(),
        correlationId: request.correlationId,
        causationId: request.messageId,
        occurredAt: dependencies.now(),
        producer: "identity-access",
        traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
        actor: { _tag: "Service", service: "identity-access" },
        payload,
      })
    ),
    Effect.flatMap(Schema.encodeEffect(MessageEnvelopeSchema)),
    Effect.map(JSON.stringify),
    Effect.mapError(replyEnvelopeFailure),
    Effect.flatMap(delivery.reply)
  )

const toProtocolReply = (actor: Actor) =>
  parse(ResolveSessionResponseSchema)({
    actor:
      actor._tag === "Anonymous"
        ? { _tag: "Anonymous" }
        : { _tag: "User", userId: actor.userId },
  }).pipe(Effect.mapError(providerFailure))

/**
 * Verifies the Gateway envelope before consulting Better Auth and always
 * settles a syntactically valid request with a correlated reply envelope.
 */
export const makeResolveSessionRpcHandler = (
  reader: SessionReader,
  dependencies: ResolveSessionRpcDependencies
) => {
  const resolve = makeResolveSessionHandler(reader)

  return <ReplyError>(
    delivery: ResolveSessionRpcDelivery<ReplyError>
  ): Effect.Effect<void, ReplyError | ResolveSessionRpcFailure> =>
    decodeJson(delivery.payload).pipe(
      Effect.flatMap(parseMessageEnvelope),
      Effect.matchEffect({
        onFailure: () =>
          Effect.logWarning("session RPC envelope rejected", {
            failure_stage: "transport",
            failure_reason: "invalid_envelope",
          }),
        onSuccess: (envelope) => {
          const process = verifyRequest(envelope).pipe(
            Effect.matchEffect({
              onFailure: (failure) =>
                replyEnvelope(delivery, envelope, failure, dependencies),
              onSuccess: (request) =>
                resolve(request.payload).pipe(
                  Effect.mapError(providerFailure),
                  Effect.flatMap(toProtocolReply),
                  Effect.matchEffect({
                    onFailure: (failure) =>
                      replyEnvelope(delivery, envelope, failure, dependencies),
                    onSuccess: (reply) =>
                      replyEnvelope(delivery, envelope, reply, dependencies),
                  })
                ),
            })
          )

          return withRemoteTraceparent(
            withMessagingSpan(
              process,
              subjects.identity.resolveSession,
              "process"
            ),
            envelope.traceparent
          )
        },
      })
    )
}
