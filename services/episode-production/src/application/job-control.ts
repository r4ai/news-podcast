import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import {
  newQueuedJob,
  type EpisodeJob,
  type IdempotencyKey,
  type JobId,
  type OwnerId,
  type QueuedJob,
  type UtcTimestamp,
} from "../domain/episode-job.js"

export type OwnerScopedJobQueryPorts<Error = never> = Readonly<{
  findOwned: (
    ownerId: OwnerId,
    jobId: JobId
  ) => Effect.Effect<EpisodeJob | undefined, Error>
  listOwned: (
    ownerId: OwnerId,
    limit: number
  ) => Effect.Effect<readonly EpisodeJob[], Error>
}>

export type CancelOwnedJobResult =
  | Readonly<{ readonly _tag: "Canceled"; readonly job: EpisodeJob }>
  | Readonly<{ readonly _tag: "NotFound" }>
  | Readonly<{ readonly _tag: "Terminal" }>

export type CancelOwnedJobPorts<Error = never> = Readonly<{
  cancelOwned: (
    ownerId: OwnerId,
    jobId: JobId,
    canceledAt: UtcTimestamp
  ) => Effect.Effect<CancelOwnedJobResult, Error>
}>

export type RetryFailedJobPorts<
  FindError = never,
  SaveError = never,
> = Readonly<{
  findOwned: (
    ownerId: OwnerId,
    jobId: JobId
  ) => Effect.Effect<EpisodeJob | undefined, FindError>
  nextJobId: Effect.Effect<JobId>
  now: Effect.Effect<UtcTimestamp>
  saveIdempotently: (job: QueuedJob) => Effect.Effect<QueuedJob, SaveError>
}>

export const getOwnedJob = <Error>(
  ports: Pick<OwnerScopedJobQueryPorts<Error>, "findOwned">,
  ownerId: OwnerId,
  jobId: JobId
) => ports.findOwned(ownerId, jobId)

export const listOwnedJobs = <Error>(
  ports: Pick<OwnerScopedJobQueryPorts<Error>, "listOwned">,
  ownerId: OwnerId,
  limit: number
) => ports.listOwned(ownerId, limit)

export const cancelOwnedJob = <Error>(
  ports: CancelOwnedJobPorts<Error>,
  ownerId: OwnerId,
  jobId: JobId,
  canceledAt: UtcTimestamp
) => ports.cancelOwned(ownerId, jobId, canceledAt)

export type RetryFailedJobResult =
  | QueuedJob
  | Readonly<{ readonly _tag: "NotFound" }>
  | Readonly<{ readonly _tag: "NotFailed" }>

export const retryFailedJob = <FindError, SaveError>(
  ports: RetryFailedJobPorts<FindError, SaveError>,
  ownerId: OwnerId,
  jobId: JobId,
  idempotencyKey: IdempotencyKey
): Effect.Effect<RetryFailedJobResult, FindError | SaveError> =>
  ports.findOwned(ownerId, jobId).pipe(
    Effect.flatMap(
      (original): Effect.Effect<RetryFailedJobResult, SaveError> => {
        if (original === undefined) {
          return Effect.succeed<RetryFailedJobResult>(
            deepFreeze({ _tag: "NotFound" as const })
          )
        }
        if (original._tag !== "Failed") {
          return Effect.succeed<RetryFailedJobResult>(
            deepFreeze({ _tag: "NotFailed" as const })
          )
        }
        return Effect.all([ports.nextJobId, ports.now]).pipe(
          Effect.flatMap(([nextJobId, now]) =>
            ports.saveIdempotently(
              newQueuedJob({
                jobId: nextJobId,
                ownerId,
                idempotencyKey,
                trigger: original.request.trigger,
                ...(original.request.articleIds === undefined
                  ? {}
                  : { articleIds: original.request.articleIds }),
                enqueuedAt: now,
              })
            )
          )
        )
      }
    )
  )
