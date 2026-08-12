import { deepFreeze } from "@news-podcast/kernel"
import { Schema } from "effect"

const uuid = <Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(name))

export const JobIdSchema = uuid("EpisodeJobId")
export type JobId = Schema.Schema.Type<typeof JobIdSchema>
export const EpisodeIdSchema = uuid("EpisodeId")
export type EpisodeId = Schema.Schema.Type<typeof EpisodeIdSchema>
export const ArticleIdSchema = uuid("ArticleId")
export type ArticleId = Schema.Schema.Type<typeof ArticleIdSchema>
export const OwnerIdSchema = Schema.NonEmptyString.check(
  Schema.isPattern(/^\S+$/),
  Schema.isMaxLength(255)
).pipe(Schema.brand("OwnerId"))
export type OwnerId = Schema.Schema.Type<typeof OwnerIdSchema>
export const UtcTimestampSchema = Schema.DateTimeUtcFromString
export type UtcTimestamp = Schema.Schema.Type<typeof UtcTimestampSchema>
export const IdempotencyKeySchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(128)
).pipe(Schema.brand("IdempotencyKey"))
export type IdempotencyKey = Schema.Schema.Type<typeof IdempotencyKeySchema>

export const CreateJobCommandSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  trigger: Schema.Literals(["manual", "scheduled"]),
  articleIds: Schema.optional(
    Schema.Array(ArticleIdSchema).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(20)
    )
  ),
})
export type CreateJobCommand = Schema.Schema.Type<typeof CreateJobCommandSchema>

const baseFields = {
  jobId: JobIdSchema,
  request: CreateJobCommandSchema,
}

export const QueuedJobSchema = Schema.TaggedStruct("Queued", {
  ...baseFields,
  attempt: Schema.Literal(0),
  enqueuedAt: UtcTimestampSchema,
})
export type QueuedJob = Schema.Schema.Type<typeof QueuedJobSchema>

const AttemptSchema = Schema.Literals([1, 2, 3, 4])
const RetryAttemptSchema = Schema.Literals([1, 2, 3])
export const LeaseTokenSchema = Schema.NonEmptyString.pipe(
  Schema.brand("LeaseToken")
)

export const RunningJobSchema = Schema.TaggedStruct("Running", {
  ...baseFields,
  attempt: AttemptSchema,
  startedAt: UtcTimestampSchema,
  lease: Schema.Struct({
    token: LeaseTokenSchema,
    leasedUntil: UtcTimestampSchema,
  }),
})
export type RunningJob = Schema.Schema.Type<typeof RunningJobSchema>
export type RetryableRunningJob = RunningJob & { readonly attempt: 1 | 2 | 3 }

export const RetryableFailureSchema = Schema.Struct({
  code: Schema.NonEmptyString.pipe(Schema.brand("FailureCode")),
  retryable: Schema.Literal(true),
})
export type RetryableFailure = Schema.Schema.Type<typeof RetryableFailureSchema>

export const RetryingJobSchema = Schema.TaggedStruct("Retrying", {
  ...baseFields,
  attempt: RetryAttemptSchema,
  retryAt: UtcTimestampSchema,
  failure: RetryableFailureSchema,
})
export type RetryingJob = Schema.Schema.Type<typeof RetryingJobSchema>

export const TerminalFailureSchema = Schema.Struct({
  code: Schema.NonEmptyString.pipe(Schema.brand("FailureCode")),
  retryable: Schema.Literal(false),
})
export type TerminalFailure = Schema.Schema.Type<typeof TerminalFailureSchema>

export const FailedJobSchema = Schema.TaggedStruct("Failed", {
  ...baseFields,
  attempt: AttemptSchema,
  failedAt: UtcTimestampSchema,
  failure: TerminalFailureSchema,
})
export type FailedJob = Schema.Schema.Type<typeof FailedJobSchema>

export const SucceededJobSchema = Schema.TaggedStruct("Succeeded", {
  ...baseFields,
  attempt: AttemptSchema,
  episodeId: EpisodeIdSchema,
  completedAt: UtcTimestampSchema,
})
export type SucceededJob = Schema.Schema.Type<typeof SucceededJobSchema>

export const CanceledJobSchema = Schema.TaggedStruct("Canceled", {
  ...baseFields,
  attempt: Schema.Natural,
  canceledAt: UtcTimestampSchema,
  reason: Schema.Literals(["requested_by_user", "service_shutdown"]),
})
export type CanceledJob = Schema.Schema.Type<typeof CanceledJobSchema>

export const EpisodeJobSchema = Schema.Union([
  QueuedJobSchema,
  RunningJobSchema,
  RetryingJobSchema,
  SucceededJobSchema,
  FailedJobSchema,
  CanceledJobSchema,
])
export type EpisodeJob = Schema.Schema.Type<typeof EpisodeJobSchema>

export const newQueuedJob = (input: {
  readonly jobId: JobId
  readonly ownerId: OwnerId
  readonly idempotencyKey: IdempotencyKey
  readonly trigger: CreateJobCommand["trigger"]
  readonly articleIds?: CreateJobCommand["articleIds"]
  readonly enqueuedAt: UtcTimestamp
}): QueuedJob =>
  deepFreeze({
    _tag: "Queued",
    jobId: input.jobId,
    request: {
      ownerId: input.ownerId,
      idempotencyKey: input.idempotencyKey,
      trigger: input.trigger,
      ...(input.articleIds === undefined
        ? {}
        : { articleIds: [...input.articleIds].sort() }),
    },
    attempt: 0,
    enqueuedAt: input.enqueuedAt,
  })

export const leaseQueuedJob = (
  job: QueuedJob,
  lease: {
    readonly token: RunningJob["lease"]["token"]
    readonly leasedUntil: UtcTimestamp
    readonly startedAt: UtcTimestamp
  }
): RunningJob & { readonly attempt: 1 } =>
  deepFreeze({
    _tag: "Running",
    jobId: job.jobId,
    request: job.request,
    attempt: 1,
    startedAt: lease.startedAt,
    lease: { token: lease.token, leasedUntil: lease.leasedUntil },
  })

const nextAttempt = (attempt: RetryingJob["attempt"]): 2 | 3 | 4 => {
  switch (attempt) {
    case 1:
      return 2
    case 2:
      return 3
    case 3:
      return 4
  }
}

export const leaseRetryingJob = (
  job: RetryingJob,
  lease: {
    readonly token: RunningJob["lease"]["token"]
    readonly leasedUntil: UtcTimestamp
    readonly startedAt: UtcTimestamp
  }
): RunningJob & { readonly attempt: 2 | 3 | 4 } =>
  deepFreeze({
    _tag: "Running",
    jobId: job.jobId,
    request: job.request,
    attempt: nextAttempt(job.attempt),
    startedAt: lease.startedAt,
    lease: { token: lease.token, leasedUntil: lease.leasedUntil },
  })

/** Replaces an expired lease without consuming another delivery attempt. */
export const recoverRunningJob = (
  job: RunningJob,
  lease: {
    readonly token: RunningJob["lease"]["token"]
    readonly leasedUntil: UtcTimestamp
    readonly startedAt: UtcTimestamp
  }
): RunningJob =>
  deepFreeze({
    ...job,
    startedAt: lease.startedAt,
    lease: { token: lease.token, leasedUntil: lease.leasedUntil },
  })

export const retryRunningJob = (
  job: RetryableRunningJob,
  retry: { readonly retryAt: UtcTimestamp; readonly failure: RetryableFailure }
): RetryingJob =>
  deepFreeze({
    _tag: "Retrying",
    jobId: job.jobId,
    request: job.request,
    attempt: job.attempt,
    retryAt: retry.retryAt,
    failure: retry.failure,
  })

export const completeRunningJob = (
  job: RunningJob,
  completed: {
    readonly episodeId: EpisodeId
    readonly completedAt: UtcTimestamp
  }
): SucceededJob =>
  deepFreeze({
    _tag: "Succeeded",
    jobId: job.jobId,
    request: job.request,
    attempt: job.attempt,
    episodeId: completed.episodeId,
    completedAt: completed.completedAt,
  })

export const failRunningJob = (
  job: RunningJob,
  failed: { readonly failedAt: UtcTimestamp; readonly failure: TerminalFailure }
): FailedJob =>
  deepFreeze({
    _tag: "Failed",
    jobId: job.jobId,
    request: job.request,
    attempt: job.attempt,
    failedAt: failed.failedAt,
    failure: failed.failure,
  })

export type CancelableJob = QueuedJob | RunningJob | RetryingJob

export const cancelJob = (
  job: CancelableJob,
  canceled: {
    readonly canceledAt: UtcTimestamp
    readonly reason: CanceledJob["reason"]
  }
): CanceledJob =>
  deepFreeze({
    _tag: "Canceled",
    jobId: job.jobId,
    request: job.request,
    attempt: job.attempt,
    canceledAt: canceled.canceledAt,
    reason: canceled.reason,
  })
