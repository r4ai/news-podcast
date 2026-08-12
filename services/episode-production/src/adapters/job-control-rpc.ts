import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  EpisodeJobControlReplySchema,
  ProductionEpisodeJobSchema,
  parseCancelEpisodeJobRequest,
  parseGetEpisodeJobRequest,
  parseListEpisodeJobsRequest,
  parseListEpisodeJobEventsRequest,
  parseMessageEnvelope,
  parseRetryEpisodeJobRequest,
  subjects,
  type EpisodeJobControlReply,
  type ProductionEpisodeJob,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import type {
  CancelOwnedJobResult,
  RetryFailedJobResult,
} from "../application/job-control.js"
import {
  OwnerIdSchema,
  IdempotencyKeySchema,
  JobIdSchema,
  UtcTimestampSchema,
  type EpisodeJob,
  type IdempotencyKey,
  type JobId,
  type OwnerId,
  type UtcTimestamp,
} from "../domain/episode-job.js"

const encodeReply = Schema.encodeSync(EpisodeJobControlReplySchema)
const decodeProductionJob = Schema.decodeUnknownSync(ProductionEpisodeJobSchema)
const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)
const decodeJobId = Schema.decodeUnknownSync(JobIdSchema)
const decodeIdempotencyKey = Schema.decodeUnknownSync(IdempotencyKeySchema)
const parseOwnerId = parse(OwnerIdSchema)

export type JobControlRpcDelivery<ReplyError = never> = Readonly<{
  readonly payload: string
  readonly reply: (payload: string) => Effect.Effect<void, ReplyError>
}>

const rejected = (
  code: Extract<EpisodeJobControlReply, { _tag: "Rejected" }>["code"]
): EpisodeJobControlReply => deepFreeze({ _tag: "Rejected", code })

const commonProjection = (job: EpisodeJob) => ({
  jobId: job.jobId,
  createdAt: encodeTimestamp(job.createdAt),
  trigger: job.request.trigger,
  ...(job.request.articleIds === undefined
    ? {}
    : { articleIds: job.request.articleIds }),
  maxAttempts: 4 as const,
})

export const projectEpisodeJob = (job: EpisodeJob): ProductionEpisodeJob => {
  const common = commonProjection(job)
  switch (job._tag) {
    case "Queued":
      return decodeProductionJob({
        ...common,
        status: "queued",
        attempt: job.attempt,
        enqueuedAt: encodeTimestamp(job.enqueuedAt),
      })
    case "Running":
      return decodeProductionJob({
        ...common,
        status: "running",
        attempt: job.attempt,
        startedAt: encodeTimestamp(job.startedAt),
      })
    case "Retrying":
      return decodeProductionJob({
        ...common,
        status: "retrying",
        attempt: job.attempt,
        retryAt: encodeTimestamp(job.retryAt),
        failure: job.failure,
      })
    case "Succeeded":
      return decodeProductionJob({
        ...common,
        status: "succeeded",
        attempt: job.attempt,
        episodeId: job.episodeId,
        completedAt: encodeTimestamp(job.completedAt),
      })
    case "Failed":
      return decodeProductionJob({
        ...common,
        status: "failed",
        attempt: job.attempt,
        failedAt: encodeTimestamp(job.failedAt),
        failure: job.failure,
      })
    case "Canceled":
      return decodeProductionJob({
        ...common,
        status: "canceled",
        attempt: job.attempt,
        canceledAt: encodeTimestamp(job.canceledAt),
        reason: job.reason,
      })
  }
}

const decodeJson = (payload: string) =>
  Effect.try({
    try: (): unknown => JSON.parse(payload),
    catch: () => deepFreeze({ _tag: "InvalidJson" as const }),
  })

const handleAuthenticated = <Request, ReplyError>(input: {
  readonly subject: string
  readonly delivery: JobControlRpcDelivery<ReplyError>
  readonly parseRequest: (value: unknown) => Effect.Effect<Request, unknown>
  readonly execute: (
    ownerId: OwnerId,
    request: Request
  ) => Effect.Effect<EpisodeJobControlReply, unknown>
}): Effect.Effect<void, ReplyError> => {
  const reply = (value: EpisodeJobControlReply) =>
    input.delivery.reply(JSON.stringify(encodeReply(value)))
  const invalid = reply(rejected("INVALID_REQUEST"))

  return decodeJson(input.delivery.payload).pipe(
    Effect.flatMap(parseMessageEnvelope),
    Effect.matchEffect({
      onFailure: () => invalid,
      onSuccess: (envelope) => {
        const process =
          envelope.actor._tag !== "User"
            ? reply(rejected("UNAUTHENTICATED"))
            : Effect.all([
                parseOwnerId(envelope.actor.userId),
                input.parseRequest(envelope.payload),
              ]).pipe(
                Effect.matchEffect({
                  onFailure: () => invalid,
                  onSuccess: ([ownerId, request]) =>
                    input.execute(ownerId, request).pipe(
                      Effect.matchEffect({
                        onFailure: () => reply(rejected("STORAGE_FAILURE")),
                        onSuccess: reply,
                      })
                    ),
                })
              )
        return withRemoteTraceparent(
          withMessagingSpan(process, input.subject, "process"),
          envelope.traceparent
        )
      },
    })
  )
}

export const handleGetJobRpc =
  <StorageError>(ports: {
    readonly findOwned: (
      ownerId: OwnerId,
      jobId: JobId
    ) => Effect.Effect<EpisodeJob | undefined, StorageError>
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.getJob,
      delivery,
      parseRequest: parseGetEpisodeJobRequest,
      execute: (ownerId, request) =>
        ports
          .findOwned(ownerId, decodeJobId(request.jobId))
          .pipe(
            Effect.map((job): EpisodeJobControlReply =>
              job === undefined
                ? { _tag: "NotFound" }
                : { _tag: "Found", job: projectEpisodeJob(job) }
            )
          ),
    })

export const handleListJobsRpc =
  <StorageError>(ports: {
    readonly listOwned: (
      ownerId: OwnerId,
      limit: number
    ) => Effect.Effect<readonly EpisodeJob[], StorageError>
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.listJobs,
      delivery,
      parseRequest: parseListEpisodeJobsRequest,
      execute: (ownerId, request) =>
        ports.listOwned(ownerId, request.limit ?? 100).pipe(
          Effect.map((jobs): EpisodeJobControlReply => ({
            _tag: "Listed",
            jobs: jobs.map(projectEpisodeJob),
          }))
        ),
    })

export const handleListJobEventsRpc =
  <StorageError>(ports: {
    readonly findOwned: (
      ownerId: OwnerId,
      jobId: JobId
    ) => Effect.Effect<EpisodeJob | undefined, StorageError>
    readonly listOwnedStatusEvents: (input: {
      readonly ownerId: OwnerId
      readonly jobId: JobId
      readonly afterSequence: number
      readonly limit: number
    }) => Effect.Effect<
      readonly Readonly<{
        readonly sequence: number
        readonly job: EpisodeJob
      }>[],
      StorageError
    >
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.listJobEvents,
      delivery,
      parseRequest: parseListEpisodeJobEventsRequest,
      execute: (ownerId, request) => {
        const jobId = decodeJobId(request.jobId)
        return ports.findOwned(ownerId, jobId).pipe(
          Effect.flatMap((job) =>
            job === undefined
              ? Effect.succeed<EpisodeJobControlReply>({ _tag: "NotFound" })
              : ports
                  .listOwnedStatusEvents({
                    ownerId,
                    jobId,
                    afterSequence: request.afterSequence ?? 0,
                    limit: request.limit ?? 100,
                  })
                  .pipe(
                    Effect.map((events): EpisodeJobControlReply => ({
                      _tag: "Events",
                      events: events.map((event) => ({
                        sequence: event.sequence,
                        job: projectEpisodeJob(event.job),
                      })),
                    }))
                  )
          )
        )
      },
    })

export const handleCancelJobRpc =
  <StorageError>(ports: {
    readonly now: Effect.Effect<UtcTimestamp>
    readonly cancelOwned: (
      ownerId: OwnerId,
      jobId: JobId,
      canceledAt: UtcTimestamp
    ) => Effect.Effect<CancelOwnedJobResult, StorageError>
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.cancelJob,
      delivery,
      parseRequest: parseCancelEpisodeJobRequest,
      execute: (ownerId, request) =>
        ports.now.pipe(
          Effect.flatMap((now) =>
            ports.cancelOwned(ownerId, decodeJobId(request.jobId), now)
          ),
          Effect.map((result): EpisodeJobControlReply => {
            switch (result._tag) {
              case "Canceled":
                return { _tag: "Canceled", job: projectEpisodeJob(result.job) }
              case "NotFound":
                return { _tag: "NotFound" }
              case "Terminal":
                return { _tag: "Conflict", code: "JOB_TERMINAL" }
            }
          })
        ),
    })

export const handleRetryJobRpc =
  <RetryError>(ports: {
    readonly retry: (
      ownerId: OwnerId,
      jobId: JobId,
      idempotencyKey: IdempotencyKey
    ) => Effect.Effect<RetryFailedJobResult, RetryError>
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.retryJob,
      delivery,
      parseRequest: parseRetryEpisodeJobRequest,
      execute: (ownerId, request) =>
        ports
          .retry(
            ownerId,
            decodeJobId(request.jobId),
            decodeIdempotencyKey(request.idempotencyKey)
          )
          .pipe(
            Effect.map((result): EpisodeJobControlReply => {
              switch (result._tag) {
                case "Queued":
                  return { _tag: "Retried", job: projectEpisodeJob(result) }
                case "NotFound":
                  return { _tag: "NotFound" }
                case "NotFailed":
                  return { _tag: "Conflict", code: "JOB_NOT_FAILED" }
              }
            })
          ),
    })
