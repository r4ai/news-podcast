import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

import { CreatedAtSchema, FeedIdSchema, FeedUrlSchema } from "./subscription.js"

const uuid = <Brand extends string>(brand: Brand) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(brand))

export const SyncJobIdSchema = uuid("FeedSyncJobId")
export type SyncJobId = Schema.Schema.Type<typeof SyncJobIdSchema>

export const FeedSyncJobStatusSchema = Schema.Literals([
  "Queued",
  "Processing",
  "Succeeded",
  "Failed",
])
export type FeedSyncJobStatus = Schema.Schema.Type<
  typeof FeedSyncJobStatusSchema
>

export const FeedSyncJobSchema = Schema.Struct({
  jobId: SyncJobIdSchema,
  feedId: FeedIdSchema,
  feedUrl: FeedUrlSchema,
  status: FeedSyncJobStatusSchema,
  attempt: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  maxAttempts: Schema.Literal(4),
  discovered: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  archived: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  createdAt: CreatedAtSchema,
  startedAt: Schema.optional(CreatedAtSchema),
  completedAt: Schema.optional(CreatedAtSchema),
  error: Schema.optional(
    Schema.NonEmptyString.check(Schema.isMaxLength(200), Schema.isPattern(/\S/))
  ),
})
export type FeedSyncJob = Schema.Schema.Type<typeof FeedSyncJobSchema>
export const parseFeedSyncJob = parse(FeedSyncJobSchema)

export type FeedSyncOutcome = Readonly<{
  readonly discovered: number
  readonly archived: number
  readonly failed: number
  readonly error?: string
}>
