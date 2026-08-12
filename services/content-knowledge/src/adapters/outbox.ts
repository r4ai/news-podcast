import { parse, type DeepReadonly } from "@news-podcast/kernel"
import {
  ActorSchema,
  ArticleArchivedV1Schema,
  CorrelationIdSchema,
  MessageIdSchema,
  TraceparentSchema,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import { CapturedAtSchema } from "../domain/article.js"

export const ArticleArchivedWireEnvelopeSchema = Schema.Struct({
  messageId: MessageIdSchema,
  correlationId: CorrelationIdSchema,
  causationId: MessageIdSchema,
  occurredAt: CapturedAtSchema,
  producer: Schema.Literal("content-knowledge"),
  traceparent: TraceparentSchema,
  actor: ActorSchema,
  payload: ArticleArchivedV1Schema,
})
export type ArticleArchivedWireEnvelope = Schema.Schema.Type<
  typeof ArticleArchivedWireEnvelopeSchema
>
export const parseArticleArchivedWireEnvelope = parse(
  ArticleArchivedWireEnvelopeSchema
)

export type PendingOutboxMessage = DeepReadonly<{
  readonly messageId: Schema.Schema.Type<typeof MessageIdSchema>
  readonly subject: typeof subjects.content.articleArchived
  readonly envelope: ArticleArchivedWireEnvelope
  readonly payload: string
}>

export type OutboxStoreError = DeepReadonly<{
  readonly _tag: "OutboxStoreFailed"
  readonly operation: "ListPending" | "MarkPublished"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type OutboxPublisherError = DeepReadonly<{
  readonly _tag: "OutboxPublishFailed"
  readonly reason: "Unavailable"
}>

export const OutboxBatchSizeSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(100)
).pipe(Schema.brand("OutboxBatchSize"))
export type OutboxBatchSize = Schema.Schema.Type<typeof OutboxBatchSizeSchema>

export type OutboxStore = DeepReadonly<{
  readonly listPending: (
    limit: OutboxBatchSize
  ) => Effect.Effect<readonly PendingOutboxMessage[], OutboxStoreError>
  readonly markPublished: (
    messageId: PendingOutboxMessage["messageId"],
    publishedAt: Schema.Schema.Type<typeof CapturedAtSchema>
  ) => Effect.Effect<void, OutboxStoreError>
}>

export type OutboxPublisher = DeepReadonly<{
  readonly publish: (message: PendingOutboxMessage) => Effect.Effect<
    DeepReadonly<{
      readonly stream: string
      readonly sequence: number
      readonly duplicate: boolean
    }>,
    OutboxPublisherError
  >
}>

export const articleArchivedSubject = subjects.content.articleArchived

export const parseOutboxLimit = parse(OutboxBatchSizeSchema)
