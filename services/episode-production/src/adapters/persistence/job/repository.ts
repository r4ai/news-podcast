import { deepFreeze } from "@news-podcast/kernel"
import {
  decodePersistedJson,
  decodePersistedJsonSync,
  isDatabaseError,
} from "@news-podcast/persistence"
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
const PersistedAgUiEventSchema = Schema.Record(Schema.String, Schema.Unknown)

export type IdempotencyConflict = Readonly<{
  readonly _tag: "IdempotencyConflict"
  readonly ownerId: string
  readonly idempotencyKey: string
}>

const persistenceError = (operation: string, cause: unknown) =>
  deepFreeze({
    _tag: "PersistenceError" as const,
    operation,
    reason: isDatabaseError(cause) ? cause.reason : ("Unavailable" as const),
  })

const decodeDocument = (document: string) =>
  decodePersistedJson("episode_jobs.document", EpisodeJobSchema, document).pipe(
    Effect.mapError((cause) => persistenceError("decode-job-json", cause))
  )

const repositoryFromHandle = (handle: SqliteJobHandle) => {
  const save = (
    job: QueuedJob,
    scheduledFirstWriteWins: boolean,
    idempotencyScope: string
  ) => {
    const encoded = encodeJob(job)
    const requestFingerprint = JSON.stringify(encoded.request)

    return Effect.try({
      try: () =>
        handle.saveIdempotently({
          ownerId: encoded.request.ownerId,
          idempotencyScope,
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
              scheduledFirstWriteWins &&
              existing.request.trigger === "scheduled" &&
              ((existing._tag === "Failed" &&
                existing.failure.code === "no_generation_candidates") ||
                (existing._tag === "Canceled" &&
                  existing.reason === "service_shutdown"))
            ) {
              const requeued: QueuedJob = deepFreeze({
                _tag: "Queued",
                jobId: existing.jobId,
                request: existing.request,
                createdAt: job.enqueuedAt,
                attempt: 0,
                enqueuedAt: job.enqueuedAt,
              })
              return Effect.sync(() =>
                handle.requeueRecoverableScheduled({
                  jobId: existing.jobId,
                  document: JSON.stringify(encodeJob(requeued)),
                })
              ).pipe(Effect.as(requeued))
            }
            if (
              result.row.requestFingerprint === requestFingerprint ||
              (scheduledFirstWriteWins &&
                encoded.request.trigger === "scheduled" &&
                existing.request.trigger === "scheduled")
            ) {
              return Effect.succeed(existing)
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
    saveIdempotently: (job: QueuedJob) => save(job, false, "create"),
    saveRetryIdempotently: (sourceJobId: JobId, job: QueuedJob) =>
      save(job, false, `retry:${sourceJobId}`),
    /** A scheduled local date is one logical request; the first accepted article set stays authoritative. */
    saveScheduledIdempotently: (job: QueuedJob) => save(job, true, "create"),
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
    listOwnedAgUiEvents: (input: {
      readonly ownerId: OwnerId
      readonly jobId: JobId
      readonly afterSequence: number
      readonly limit: number
    }) =>
      Effect.try({
        try: () => handle.listOwnedAgUiEvents(input),
        catch: (cause) => persistenceError("list-owned-job-events", cause),
      }).pipe(
        Effect.flatMap((rows) =>
          Effect.try({
            try: () =>
              rows.map((row) => ({
                sequence: row.sequence,
                event: decodePersistedJsonSync(
                  "episode_job_agui_events.payload",
                  PersistedAgUiEventSchema,
                  row.payload
                ),
              })),
            catch: (cause) => persistenceError("decode-agui-event", cause),
          })
        )
      ),
    cancelOwned: (ownerId: OwnerId, jobId: JobId, canceledAt: UtcTimestamp) =>
      Effect.try({
        try: () => {
          const result = handle.replaceOwnedActive({
            ownerId,
            jobId,
            replace: (document) => {
              const current = decodePersistedJsonSync(
                "episode_jobs.document",
                EpisodeJobSchema,
                document
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
          if (result._tag !== "Updated") return result
          const job = decodePersistedJsonSync(
            "episode_jobs.document",
            EpisodeJobSchema,
            result.document
          )
          if (job._tag !== "Canceled")
            throw new Error("cancellation did not persist a canceled job")
          return { _tag: "Canceled" as const, job } as const
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
