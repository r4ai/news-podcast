import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  EpisodeJobSchema,
  UtcTimestampSchema,
  cancelJob,
  type EpisodeJob,
  type JobId,
  type OwnerId,
  type QueuedJob,
  type UtcTimestamp,
} from "../../../domain/episode-job.js"
import type { ProductionDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { makeJobHandle } from "./handle.js"
import type { SqliteJobHandle } from "./ports.js"

const encodeJob = Schema.encodeSync(EpisodeJobSchema)
const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)
const parseJob = parse(EpisodeJobSchema)

export type IdempotencyConflict = Readonly<{
  readonly _tag: "IdempotencyConflict"
  readonly ownerId: string
  readonly idempotencyKey: string
}>

const persistenceError = (operation: string, cause: unknown) =>
  deepFreeze({ _tag: "PersistenceError" as const, operation, cause })

const decodeDocument = (document: string) =>
  Effect.try({
    try: () => JSON.parse(document) as unknown,
    catch: (cause) => persistenceError("decode-job-json", cause),
  }).pipe(Effect.flatMap(parseJob))

const repositoryFromHandle = (handle: SqliteJobHandle) => {
  const save = (job: QueuedJob, scheduledFirstWriteWins: boolean) => {
    const encoded = encodeJob(job)
    const requestFingerprint = JSON.stringify(encoded.request)

    return Effect.try({
      try: () =>
        handle.saveIdempotently({
          ownerId: encoded.request.ownerId,
          idempotencyKey: encoded.request.idempotencyKey,
          requestFingerprint,
          jobId: encoded.jobId,
          document: JSON.stringify(encoded),
        }),
      catch: (cause) => persistenceError("save-job", cause),
    }).pipe(
      Effect.flatMap((result) => {
        if (result._tag === "Inserted") return Effect.succeed(job)
        return decodeDocument(result.row.document).pipe(
          Effect.flatMap((existing) => {
            if (
              result.row.requestFingerprint === requestFingerprint ||
              (scheduledFirstWriteWins &&
                encoded.request.trigger === "scheduled" &&
                existing.request.trigger === "scheduled")
            ) {
              return Effect.succeed(existing as QueuedJob)
            }
            return Effect.fail(
              deepFreeze({
                _tag: "IdempotencyConflict" as const,
                ownerId: encoded.request.ownerId,
                idempotencyKey: encoded.request.idempotencyKey,
              })
            )
          })
        )
      }),
      Effect.withSpan("sqlite episode_jobs save", {
        kind: "client",
        attributes: {
          "db.system.name": "sqlite",
          "db.namespace": "episode-production",
          "db.operation.name": "INSERT",
        },
      })
    )
  }

  return {
    saveIdempotently: (job: QueuedJob) => save(job, false),
    /** A scheduled local date is one logical request; the first accepted article set stays authoritative. */
    saveScheduledIdempotently: (job: QueuedJob) => save(job, true),
    findById: (jobId: JobId): Effect.Effect<EpisodeJob | undefined, unknown> =>
      Effect.try({
        try: () => handle.findById(jobId),
        catch: (cause) => persistenceError("find-job", cause),
      }).pipe(
        Effect.flatMap((document) =>
          document === undefined
            ? Effect.succeed(undefined)
            : decodeDocument(document)
        ),
        Effect.withSpan("sqlite episode_jobs find", {
          kind: "client",
          attributes: {
            "db.system.name": "sqlite",
            "db.namespace": "episode-production",
            "db.operation.name": "SELECT",
          },
        })
      ),
    findOwned: (
      ownerId: OwnerId,
      jobId: JobId
    ): Effect.Effect<EpisodeJob | undefined, unknown> =>
      Effect.try({
        try: () => handle.findOwned(ownerId, jobId),
        catch: (cause) => persistenceError("find-owned-job", cause),
      }).pipe(
        Effect.flatMap((document) =>
          document === undefined
            ? Effect.succeed(undefined)
            : decodeDocument(document)
        )
      ),
    listOwned: (
      ownerId: OwnerId,
      limit: number
    ): Effect.Effect<readonly EpisodeJob[], unknown> =>
      Effect.try({
        try: () => handle.listOwned(ownerId, limit),
        catch: (cause) => persistenceError("list-owned-jobs", cause),
      }).pipe(
        Effect.flatMap((documents) =>
          Effect.all(documents.map(decodeDocument), { concurrency: 1 })
        )
      ),
    statusSnapshot: () =>
      Effect.try({
        try: () => handle.statusSnapshot(),
        catch: (cause) => persistenceError("status-snapshot", cause),
      }),
    listOwnedStatusEvents: (input: {
      readonly ownerId: OwnerId
      readonly jobId: JobId
      readonly afterSequence: number
      readonly limit: number
    }) =>
      Effect.try({
        try: () => handle.listOwnedStatusEvents(input),
        catch: (cause) => persistenceError("list-owned-job-events", cause),
      }).pipe(
        Effect.flatMap((rows) =>
          Effect.all(
            rows.map((row) =>
              decodeDocument(row.document).pipe(
                Effect.map((job) => ({ sequence: row.sequence, job }))
              )
            ),
            { concurrency: 1 }
          )
        )
      ),
    cancelOwned: (ownerId: OwnerId, jobId: JobId, canceledAt: UtcTimestamp) =>
      Effect.try({
        try: () => {
          const result = handle.replaceOwnedActive({
            ownerId,
            jobId,
            replace: (document) => {
              const current = Schema.decodeUnknownSync(EpisodeJobSchema)(
                JSON.parse(document) as unknown
              )
              if (
                current._tag !== "Queued" &&
                current._tag !== "Running" &&
                current._tag !== "Retrying"
              ) {
                throw new Error("active job changed during cancellation")
              }
              return JSON.stringify(
                encodeJob(
                  cancelJob(current, {
                    canceledAt: Schema.decodeUnknownSync(UtcTimestampSchema)(
                      encodeTimestamp(canceledAt)
                    ),
                    reason: "requested_by_user",
                  })
                )
              )
            },
          })
          return result._tag === "Updated"
            ? ({
                _tag: "Canceled" as const,
                job: Schema.decodeUnknownSync(EpisodeJobSchema)(
                  JSON.parse(result.document) as unknown
                ),
              } as const)
            : result
        },
        catch: (cause) => persistenceError("cancel-owned-job", cause),
      }),
  }
}

export type SqliteJobRepository = ReturnType<typeof repositoryFromHandle>

/** 接続はサービスプロセスが1本だけ所有し、リポジトリはそれを借りる。 */
export const jobRepository = (
  database: ProductionDatabase
): Effect.Effect<SqliteJobRepository, unknown> =>
  Effect.try({
    try: () => repositoryFromHandle(makeJobHandle(database)),
    catch: (cause) => persistenceError("open-database", cause),
  })
