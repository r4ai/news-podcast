import { episodeFailureCodes } from "@news-podcast/contracts/episode-failure"
import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

const uuid = <Brand extends string>(brand: Brand) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(brand))
const boundedText = (maximum: number) =>
  Schema.NonEmptyString.check(
    Schema.isPattern(/\S/),
    Schema.isMaxLength(maximum)
  )
const UtcInstantSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter((value: string) =>
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
      ? true
      : "expected a real UTC instant"
  )
)

const EpisodeJobIdSchema = uuid("ProductionEpisodeJobId")
const EpisodeIdSchema = uuid("ProductionEpisodeId")
const ArticleIdSchema = uuid("ProductionArticleId")
const IdempotencyKeySchema = boundedText(128).pipe(
  Schema.brand("ProductionIdempotencyKey")
)
const commonJobFields = {
  jobId: EpisodeJobIdSchema,
  createdAt: UtcInstantSchema,
  trigger: Schema.Literals(["manual", "scheduled"]),
  articleIds: Schema.optional(
    Schema.NonEmptyArray(ArticleIdSchema).check(Schema.isMaxLength(20))
  ),
  maxAttempts: Schema.Literal(4),
}
const EpisodeJobStageSchema = Schema.Literals([
  "selecting_articles",
  "materializing_articles",
  "generating_script",
  "preparing_pronunciation",
  "synthesizing_audio",
  "storing_episode",
])
const ForwardCompatibleEpisodeFailureCodeSchema = Schema.Union([
  Schema.Literals(episodeFailureCodes),
  boundedText(200),
])

export const CreateEpisodeJobReplySchema = Schema.Union([
  Schema.TaggedStruct("Accepted", {
    jobId: EpisodeJobIdSchema,
    state: Schema.Literal("Queued"),
  }),
  Schema.TaggedStruct("Rejected", {
    code: Schema.Literals([
      "INVALID_REQUEST",
      "UNAUTHENTICATED",
      "IDEMPOTENCY_CONFLICT",
      "INTERNAL_ERROR",
    ]),
  }),
])
export type CreateEpisodeJobReply = Schema.Schema.Type<
  typeof CreateEpisodeJobReplySchema
>
export const parseCreateEpisodeJobReply = parse(CreateEpisodeJobReplySchema)

export const ProductionEpisodeJobSchema = Schema.Union([
  Schema.Struct({
    ...commonJobFields,
    status: Schema.Literal("queued"),
    attempt: Schema.Literal(0),
    enqueuedAt: UtcInstantSchema,
  }),
  Schema.Struct({
    ...commonJobFields,
    status: Schema.Literal("running"),
    attempt: Schema.Literals([1, 2, 3, 4]),
    startedAt: UtcInstantSchema,
    stage: Schema.optional(EpisodeJobStageSchema),
    stageStartedAt: Schema.optional(UtcInstantSchema),
    lastProgressAt: Schema.optional(UtcInstantSchema),
    stageProgress: Schema.optional(
      Schema.Struct({
        completed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        total: Schema.Int.check(Schema.isGreaterThan(0)),
      }).check(Schema.makeFilter(({ completed, total }) => completed <= total))
    ),
  }),
  Schema.Struct({
    ...commonJobFields,
    status: Schema.Literal("retrying"),
    attempt: Schema.Literals([1, 2, 3]),
    retryAt: UtcInstantSchema,
    failure: Schema.Struct({
      code: ForwardCompatibleEpisodeFailureCodeSchema,
      retryable: Schema.Literal(true),
    }),
  }),
  Schema.Struct({
    ...commonJobFields,
    status: Schema.Literal("succeeded"),
    attempt: Schema.Literals([1, 2, 3, 4]),
    episodeId: EpisodeIdSchema,
    completedAt: UtcInstantSchema,
  }),
  Schema.Struct({
    ...commonJobFields,
    status: Schema.Literal("failed"),
    attempt: Schema.Literals([1, 2, 3, 4]),
    failedAt: UtcInstantSchema,
    failure: Schema.Struct({
      code: ForwardCompatibleEpisodeFailureCodeSchema,
      retryable: Schema.Literal(false),
    }),
  }),
  Schema.Struct({
    ...commonJobFields,
    status: Schema.Literal("canceled"),
    attempt: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(4)
    ),
    canceledAt: UtcInstantSchema,
    reason: Schema.Literals(["requested_by_user", "service_shutdown"]),
  }),
])
export type ProductionEpisodeJob = Schema.Schema.Type<
  typeof ProductionEpisodeJobSchema
>

export const GetEpisodeJobRequestSchema = Schema.Struct({
  jobId: EpisodeJobIdSchema,
})
export const parseGetEpisodeJobRequest = parse(GetEpisodeJobRequestSchema)

export const ListEpisodeJobsRequestSchema = Schema.Struct({
  limit: Schema.optional(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(100)
    )
  ),
})
export const parseListEpisodeJobsRequest = parse(ListEpisodeJobsRequestSchema)

export const ListEpisodeJobEventsRequestSchema = Schema.Struct({
  jobId: EpisodeJobIdSchema,
  afterSequence: Schema.optional(Schema.Natural),
  limit: Schema.optional(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(100)
    )
  ),
})
export const parseListEpisodeJobEventsRequest = parse(
  ListEpisodeJobEventsRequestSchema
)

export const CancelEpisodeJobRequestSchema = Schema.Struct({
  jobId: EpisodeJobIdSchema,
})
export const parseCancelEpisodeJobRequest = parse(CancelEpisodeJobRequestSchema)

export const RetryEpisodeJobRequestSchema = Schema.Struct({
  jobId: EpisodeJobIdSchema,
  idempotencyKey: IdempotencyKeySchema,
})
export const parseRetryEpisodeJobRequest = parse(RetryEpisodeJobRequestSchema)

export const EpisodeJobControlRejectionSchema = Schema.TaggedStruct(
  "Rejected",
  {
    code: Schema.Literals([
      "INVALID_REQUEST",
      "UNAUTHENTICATED",
      "STORAGE_FAILURE",
      "INTERNAL_ERROR",
    ]),
  }
)

export const EpisodeJobControlReplySchema = Schema.Union([
  Schema.TaggedStruct("Found", { job: ProductionEpisodeJobSchema }),
  Schema.TaggedStruct("Listed", {
    jobs: Schema.Array(ProductionEpisodeJobSchema).check(
      Schema.isMaxLength(100)
    ),
  }),
  Schema.TaggedStruct("Events", {
    events: Schema.Array(
      Schema.Struct({
        sequence: Schema.Int.check(Schema.isGreaterThan(0)),
        event: Schema.Unknown,
      })
    ).check(Schema.isMaxLength(100)),
  }),
  Schema.TaggedStruct("Canceled", { job: ProductionEpisodeJobSchema }),
  Schema.TaggedStruct("Retried", { job: ProductionEpisodeJobSchema }),
  Schema.TaggedStruct("NotFound", {}),
  Schema.TaggedStruct("Conflict", {
    code: Schema.Literals(["JOB_TERMINAL", "JOB_NOT_FAILED"]),
  }),
  EpisodeJobControlRejectionSchema,
])
export type EpisodeJobControlReply = Schema.Schema.Type<
  typeof EpisodeJobControlReplySchema
>
export const parseEpisodeJobControlReply = parse(EpisodeJobControlReplySchema)
