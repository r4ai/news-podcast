import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  withMessagingSpan,
  withRemoteTraceparent,
} from "@news-podcast/observability"
import {
  EpisodeJobControlReplySchema,
  MessageEnvelopeSchema,
  matchesPeerPolicy,
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
} from "../../application/job-control.js"
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
} from "../../domain/episode-job.js"

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

export type JobControlRpcReplyDependencies = Readonly<{
  readonly newMessageId: () => string
  readonly now: () => string
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
        ...(job.stage === undefined ? {} : { stage: job.stage }),
        ...(job.stageStartedAt === undefined
          ? {}
          : { stageStartedAt: encodeTimestamp(job.stageStartedAt) }),
        ...(job.lastProgressAt === undefined
          ? {}
          : { lastProgressAt: encodeTimestamp(job.lastProgressAt) }),
        ...(job.stageProgress === undefined
          ? {}
          : { stageProgress: job.stageProgress }),
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
  readonly replyDependencies: JobControlRpcReplyDependencies
  readonly execute: (
    ownerId: OwnerId,
    request: Request
  ) => Effect.Effect<EpisodeJobControlReply, unknown>
}): Effect.Effect<void, ReplyError> => {
  const invalid = Effect.logWarning("job control RPC envelope rejected", {
    subject: input.subject,
    failure_stage: "transport",
    failure_reason: "invalid_envelope",
  })

  return decodeJson(input.delivery.payload).pipe(
    Effect.flatMap(parseMessageEnvelope),
    Effect.matchEffect({
      onFailure: () => invalid,
      onSuccess: (envelope) => {
        const reply = (value: EpisodeJobControlReply) =>
          Effect.currentSpan.pipe(
            Effect.orDie,
            Effect.flatMap((span) =>
              parse(MessageEnvelopeSchema)({
                messageId: input.replyDependencies.newMessageId(),
                correlationId: envelope.correlationId,
                causationId: envelope.messageId,
                occurredAt: input.replyDependencies.now(),
                producer: "episode-production",
                traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`,
                actor: { _tag: "Service", service: "episode-production" },
                payload: encodeReply(value),
              }).pipe(
                Effect.orDie,
                Effect.flatMap(Schema.encodeEffect(MessageEnvelopeSchema)),
                Effect.orDie
              )
            ),
            Effect.map(JSON.stringify),
            Effect.flatMap(input.delivery.reply)
          )
        const process =
          envelope.actor._tag !== "User" ||
          !matchesPeerPolicy(envelope, {
            producer: "gateway",
            actor: "User",
          })
            ? reply(rejected("UNAUTHENTICATED"))
            : Effect.all([
                parseOwnerId(envelope.actor.userId),
                input.parseRequest(envelope.payload),
              ]).pipe(
                Effect.matchEffect({
                  onFailure: () => reply(rejected("INVALID_REQUEST")),
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
    readonly replyDependencies: JobControlRpcReplyDependencies
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.getJob,
      delivery,
      parseRequest: parseGetEpisodeJobRequest,
      replyDependencies: ports.replyDependencies,
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
    readonly replyDependencies: JobControlRpcReplyDependencies
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.listJobs,
      delivery,
      parseRequest: parseListEpisodeJobsRequest,
      replyDependencies: ports.replyDependencies,
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
    readonly listOwnedAgUiEvents: (input: {
      readonly ownerId: OwnerId
      readonly jobId: JobId
      readonly afterSequence: number
      readonly limit: number
    }) => Effect.Effect<
      readonly Readonly<{
        readonly sequence: number
        readonly event: unknown
      }>[],
      StorageError
    >
    readonly replyDependencies: JobControlRpcReplyDependencies
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.listJobEvents,
      delivery,
      parseRequest: parseListEpisodeJobEventsRequest,
      replyDependencies: ports.replyDependencies,
      execute: (ownerId, request) => {
        const jobId = decodeJobId(request.jobId)
        return ports.findOwned(ownerId, jobId).pipe(
          Effect.flatMap((job) =>
            job === undefined
              ? Effect.succeed<EpisodeJobControlReply>({ _tag: "NotFound" })
              : ports
                  .listOwnedAgUiEvents({
                    ownerId,
                    jobId,
                    afterSequence: request.afterSequence ?? 0,
                    limit: request.limit ?? 100,
                  })
                  .pipe(
                    Effect.map((events): EpisodeJobControlReply => ({
                      _tag: "Events",
                      events,
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
    readonly onCanceled?: (
      job: Extract<EpisodeJob, { _tag: "Canceled" }>
    ) => void
    readonly replyDependencies: JobControlRpcReplyDependencies
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.cancelJob,
      delivery,
      parseRequest: parseCancelEpisodeJobRequest,
      replyDependencies: ports.replyDependencies,
      execute: (ownerId, request) =>
        ports.now.pipe(
          Effect.flatMap((now) =>
            ports.cancelOwned(ownerId, decodeJobId(request.jobId), now)
          ),
          Effect.tap((result) =>
            result._tag === "Canceled"
              ? Effect.sync(() => ports.onCanceled?.(result.job))
              : Effect.void
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
    readonly replyDependencies: JobControlRpcReplyDependencies
  }) =>
  <ReplyError>(delivery: JobControlRpcDelivery<ReplyError>) =>
    handleAuthenticated({
      subject: subjects.production.retryJob,
      delivery,
      parseRequest: parseRetryEpisodeJobRequest,
      replyDependencies: ports.replyDependencies,
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
                case "Running":
                case "Retrying":
                case "Succeeded":
                case "Failed":
                case "Canceled":
                  return { _tag: "Retried", job: projectEpisodeJob(result) }
                case "NotFound":
                  return { _tag: "NotFound" }
                case "NotFailed":
                  return { _tag: "Conflict", code: "JOB_NOT_FAILED" }
              }
            })
          ),
    })
