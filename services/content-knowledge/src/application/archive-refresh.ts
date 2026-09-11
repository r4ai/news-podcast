import {
  ActorSchema,
  CorrelationIdSchema,
  MessageIdSchema,
  TraceparentSchema,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { ArticleIdSchema } from "../domain/article.js"
import { OwnerIdSchema } from "../domain/subscription.js"

export const ArchiveRefreshContextSchema = Schema.Struct({
  messageId: MessageIdSchema,
  correlationId: CorrelationIdSchema,
  traceparent: TraceparentSchema,
  actor: ActorSchema,
})
export const ArchiveRefreshJobSchema = Schema.Struct({
  jobId: Schema.String.check(Schema.isUUID(4)),
  status: Schema.Literals(["queued", "processing", "succeeded", "failed"]),
  createdAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.Literals(["deadline", "capture", "canceled"])),
})
export type ArchiveRefreshJob = Schema.Schema.Type<
  typeof ArchiveRefreshJobSchema
>
export type ArchiveRefreshInput = Readonly<{
  ownerId: Schema.Schema.Type<typeof OwnerIdSchema>
  articleId: Schema.Schema.Type<typeof ArticleIdSchema>
  context: Schema.Schema.Type<typeof ArchiveRefreshContextSchema>
}>
export type ArchiveRefreshFailure = Readonly<{
  _tag: "ArchiveRefreshFailed"
  reason: "storage" | "capacity" | "rate"
}>
export type ClaimedArchiveRefresh = ArchiveRefreshInput &
  Readonly<{ job: ArchiveRefreshJob; deadlineAt: string }>
export type ArchiveRefreshQueue = Readonly<{
  stats: () => Effect.Effect<
    { queued: number; processing: number; expired: number },
    ArchiveRefreshFailure
  >
  enqueue: (
    input: ArchiveRefreshInput,
    now: string
  ) => Effect.Effect<
    { job: ArchiveRefreshJob; reused: boolean },
    ArchiveRefreshFailure
  >
  find: (
    ownerId: string,
    articleId: string,
    jobId: string,
    now: string
  ) => Effect.Effect<ArchiveRefreshJob | undefined, ArchiveRefreshFailure>
  claim: (
    now: string
  ) => Effect.Effect<ClaimedArchiveRefresh | undefined, ArchiveRefreshFailure>
  complete: (
    jobId: string,
    error: ArchiveRefreshJob["error"],
    now: string
  ) => Effect.Effect<void, ArchiveRefreshFailure>
}>
