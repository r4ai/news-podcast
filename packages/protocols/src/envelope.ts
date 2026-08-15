import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

export const MessageIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("MessageId")
)
export type MessageId = Schema.Schema.Type<typeof MessageIdSchema>

export const CorrelationIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("CorrelationId")
)
export type CorrelationId = Schema.Schema.Type<typeof CorrelationIdSchema>

export const TraceparentSchema = Schema.String.check(
  Schema.isPattern(
    /^(?!ff)[\da-f]{2}-(?!0{32})[\da-f]{32}-(?!0{16})[\da-f]{16}-[\da-f]{2}$/
  )
).pipe(Schema.brand("Traceparent"))
export type Traceparent = Schema.Schema.Type<typeof TraceparentSchema>

export const ServiceNameSchema = Schema.NonEmptyString.check(
  Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
).pipe(Schema.brand("ServiceName"))
export type ServiceName = Schema.Schema.Type<typeof ServiceNameSchema>

export const ActorSchema = Schema.Union([
  Schema.TaggedStruct("Anonymous", {}),
  Schema.TaggedStruct("User", {
    userId: Schema.NonEmptyString.check(
      Schema.isPattern(/^\S+$/),
      Schema.isMaxLength(255)
    ).pipe(Schema.brand("UserId")),
  }),
  Schema.TaggedStruct("Service", { service: ServiceNameSchema }),
])
export type Actor = Schema.Schema.Type<typeof ActorSchema>

export const messageEnvelope = <Payload extends Schema.Top>(payload: Payload) =>
  Schema.Struct({
    messageId: MessageIdSchema,
    correlationId: CorrelationIdSchema,
    causationId: MessageIdSchema,
    occurredAt: Schema.DateTimeUtcFromString,
    producer: ServiceNameSchema,
    traceparent: TraceparentSchema,
    actor: ActorSchema,
    payload,
  })

export const MessageEnvelopeSchema = messageEnvelope(Schema.Unknown)
export type MessageEnvelope = Schema.Schema.Type<typeof MessageEnvelopeSchema>
export const parseMessageEnvelope = parse(MessageEnvelopeSchema)

export type PeerPolicy =
  | Readonly<{ producer: string; actor: "User" | "Anonymous" }>
  | Readonly<{ producer: string; actor: "Service"; service: string }>

/** NATSの搬送メタデータを一箇所で照合する。認証/ACLの代替ではない。 */
export const matchesPeerPolicy = (
  envelope: MessageEnvelope,
  policy: PeerPolicy
): boolean =>
  envelope.producer === policy.producer &&
  envelope.actor._tag === policy.actor &&
  (policy.actor !== "Service" ||
    (envelope.actor._tag === "Service" &&
      envelope.actor.service === policy.service))
