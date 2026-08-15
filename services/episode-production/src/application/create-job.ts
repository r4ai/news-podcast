import { Effect } from "effect"

import {
  newQueuedJob,
  type CreateJobCommand,
  type JobId,
  type QueuedJob,
  type UtcTimestamp,
} from "../domain/episode-job.js"

export type CreateJobPorts<SaveError = never> = Readonly<{
  nextJobId: Effect.Effect<JobId>
  now: Effect.Effect<UtcTimestamp>
  saveIdempotently: (job: QueuedJob) => Effect.Effect<QueuedJob, SaveError>
}>

export type CreateJobInput = CreateJobCommand &
  Readonly<{
    articleIds: NonNullable<CreateJobCommand["articleIds"]>
  }>

export const createJob = <SaveError>(ports: CreateJobPorts<SaveError>) =>
  Effect.fn("episode-production.create-job")(function* (
    command: CreateJobInput
  ) {
    const [jobId, now] = yield* Effect.all([ports.nextJobId, ports.now])
    return yield* ports.saveIdempotently(
      newQueuedJob({
        jobId,
        ownerId: command.ownerId,
        idempotencyKey: command.idempotencyKey,
        trigger: command.trigger,
        articleIds: command.articleIds,
        enqueuedAt: now,
      })
    )
  })
