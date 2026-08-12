import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema, Scope } from "effect"

import {
  EpisodeJobSchema,
  type EpisodeJob,
  type JobId,
  type QueuedJob,
} from "../domain/episode-job.js"
import {
  openSqliteJobHandle,
  type SqliteJobHandle,
} from "../infrastructure/unsafe/sqlite.js"

const encodeJob = Schema.encodeSync(EpisodeJobSchema)
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

const repositoryFromHandle = (handle: SqliteJobHandle) => ({
  saveIdempotently: (job: QueuedJob) => {
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
        if (result.row.requestFingerprint !== requestFingerprint) {
          return Effect.fail(
            deepFreeze({
              _tag: "IdempotencyConflict" as const,
              ownerId: encoded.request.ownerId,
              idempotencyKey: encoded.request.idempotencyKey,
            })
          )
        }
        return decodeDocument(result.row.document) as Effect.Effect<
          QueuedJob,
          unknown
        >
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
  },
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
})

export type SqliteJobRepository = ReturnType<typeof repositoryFromHandle>

/** Scoped acquisition makes DB lifetime and open failures part of the Effect graph. */
export const sqliteJobRepository = (
  databasePath: string
): Effect.Effect<SqliteJobRepository, unknown, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      try: () => openSqliteJobHandle(databasePath),
      catch: (cause) => persistenceError("open-database", cause),
    }),
    (handle) => Effect.sync(() => handle.close())
  ).pipe(Effect.map(repositoryFromHandle))
