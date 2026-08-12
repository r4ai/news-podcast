import { deepFreeze } from "@news-podcast/kernel"
import { Effect, Schema, Scope } from "effect"

import type {
  EpisodeCompletionIntent,
  EpisodeExecutionCheckpoint,
  EpisodeExecutionPorts,
  LeaseNextInput,
  PipelineFailure,
  StoredAudioCheckpoint,
} from "../application/execution-ports.js"
import type { GeneratedScript } from "../application/script-generator.js"
import {
  EpisodeIdSchema,
  EpisodeJobSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
  leaseQueuedJob,
  leaseRetryingJob,
  recoverRunningJob,
  type EpisodeJob,
  type JobId,
  type RunningJob,
  type UtcTimestamp,
} from "../domain/episode-job.js"
import {
  openSqliteJobHandle,
  type SqliteJobHandle,
} from "../infrastructure/unsafe/sqlite.js"

const encodeJob = Schema.encodeSync(EpisodeJobSchema)
const decodeJob = Schema.decodeUnknownSync(EpisodeJobSchema)
const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)

const ScriptSchema = Schema.Struct({
  title: Schema.String,
  script: Schema.String,
  sourceUrls: Schema.Array(Schema.String),
})
const AudioSchema = Schema.Struct({
  episodeId: EpisodeIdSchema,
  objectKey: Schema.String,
  byteLength: Schema.Number,
  contentType: Schema.Literals(["audio/wav", "audio/mpeg"]),
})
const CompletionSchema = Schema.Struct({
  episodeId: EpisodeIdSchema,
  ownerId: OwnerIdSchema,
  title: Schema.String,
  script: Schema.String,
  audio: AudioSchema,
  sources: Schema.Array(
    Schema.Struct({
      articleId: Schema.String,
      snapshotId: Schema.String,
      url: Schema.String,
      title: Schema.String,
      publishedAt: Schema.optional(Schema.String),
    })
  ),
  completedAt: UtcTimestampSchema,
  traceparent: Schema.String.check(
    Schema.isPattern(
      /^(?!ff)[\da-f]{2}-(?!0{32})[\da-f]{32}-(?!0{16})[\da-f]{16}-[\da-f]{2}$/
    )
  ),
})

const pipelineFailure = (code: string, retryable = true): PipelineFailure =>
  deepFreeze({ _tag: "PipelineFailure", code, retryable })
const staleLease = () => deepFreeze({ _tag: "StaleLease" as const })

const stringify = (value: unknown) => JSON.stringify(value)
const parseJson = (value: string) => JSON.parse(value) as unknown

const tryPersistence = <Value>(operation: string, run: () => Value) =>
  Effect.try({
    try: run,
    catch: () => pipelineFailure(`sqlite_${operation}`),
  })

const leaseDocument = (input: LeaseNextInput, document: string) => {
  const job = decodeJob(parseJson(document))
  const lease = {
    token: input.leaseToken,
    leasedUntil: input.leasedUntil,
    startedAt: input.now,
  }
  switch (job._tag) {
    case "Queued":
      return leaseQueuedJob(job, lease)
    case "Retrying":
      return leaseRetryingJob(job, lease)
    case "Running":
      return recoverRunningJob(job, lease)
    default:
      throw new Error(`terminal job cannot be leased: ${job._tag}`)
  }
}

const repositoryFromHandle = (handle: SqliteJobHandle) => {
  const persistence: EpisodeExecutionPorts["persistence"] = {
    assertLease: ({ jobId, leaseToken }) =>
      tryPersistence("assert_lease", () =>
        handle.hasLease(jobId, leaseToken)
      ).pipe(
        Effect.flatMap((current) =>
          current ? Effect.void : Effect.fail(staleLease())
        )
      ),
    loadCheckpoint: (jobId) =>
      tryPersistence("load_checkpoint", () =>
        handle.loadCheckpoint(jobId)
      ).pipe(
        Effect.flatMap((row) => {
          if (row === undefined) return Effect.succeed(undefined)
          return tryPersistence(
            "decode_checkpoint",
            () =>
              deepFreeze({
                script: Schema.decodeUnknownSync(ScriptSchema)(
                  parseJson(row.script)
                ) as GeneratedScript,
                ...(row.audio === undefined
                  ? {}
                  : {
                      audio: Schema.decodeUnknownSync(AudioSchema)(
                        parseJson(row.audio)
                      ) as StoredAudioCheckpoint,
                    }),
              }) as EpisodeExecutionCheckpoint
          )
        })
      ),
    saveScriptCheckpoint: (input) =>
      tryPersistence("save_script_checkpoint", () =>
        handle.saveScriptCheckpoint({
          jobId: input.jobId,
          leaseToken: input.leaseToken,
          script: stringify(input.script),
        })
      ).pipe(
        Effect.flatMap((applied) =>
          applied ? Effect.void : Effect.fail(staleLease())
        )
      ),
    saveAudioCheckpoint: (input) =>
      tryPersistence("save_audio_checkpoint", () =>
        handle.saveAudioCheckpoint({
          jobId: input.jobId,
          leaseToken: input.leaseToken,
          audio: stringify(input.audio),
        })
      ).pipe(
        Effect.flatMap(
          (
            result
          ): Effect.Effect<
            void,
            PipelineFailure | ReturnType<typeof staleLease>
          > => {
            switch (result) {
              case "Applied":
                return Effect.void
              case "StaleLease":
                return Effect.fail(staleLease())
              case "MissingScript":
                return Effect.fail(
                  pipelineFailure("sqlite_checkpoint_missing_script", false)
                )
            }
          }
        )
      ),
    transition: (input) =>
      input.state.jobId !== input.jobId ||
      !["Retrying", "Failed", "Canceled"].includes(input.state._tag)
        ? Effect.fail(pipelineFailure("invalid_job_transition", false))
        : tryPersistence("transition", () =>
            handle.transition({
              jobId: input.jobId,
              leaseToken: input.leaseToken,
              document: stringify(encodeJob(input.state)),
            })
          ).pipe(Effect.map((applied) => (applied ? "Applied" : "StaleLease"))),
    completeWithOutbox: (input) =>
      input.state._tag !== "Succeeded" ||
      input.state.jobId !== input.jobId ||
      input.state.episodeId !== input.completion.episodeId
        ? Effect.fail(pipelineFailure("invalid_completion_transition", false))
        : tryPersistence("complete_with_outbox", () =>
            handle.completeWithOutbox({
              jobId: input.jobId,
              leaseToken: input.leaseToken,
              document: stringify(encodeJob(input.state)),
              episodeId: input.completion.episodeId,
              payload: stringify(input.completion),
              createdAt: encodeTimestamp(input.completion.completedAt),
            })
          ),
  }

  return {
    ...persistence,
    leaseNext: (input: LeaseNextInput) =>
      tryPersistence("lease_next", () =>
        handle.leaseNext({
          now: encodeTimestamp(input.now),
          replace: (document) =>
            stringify(encodeJob(leaseDocument(input, document))),
        })
      ).pipe(
        Effect.map((row) =>
          row === undefined
            ? undefined
            : deepFreeze({
                job: decodeJob(parseJson(row.document)) as RunningJob,
                recovered: row.recovered,
              })
        )
      ),
    findById: (jobId: JobId) =>
      tryPersistence("find_job", () => handle.findById(jobId)).pipe(
        Effect.map((document): EpisodeJob | undefined =>
          document === undefined ? undefined : decodeJob(parseJson(document))
        )
      ),
    findCompletionOutbox: (jobId: JobId) =>
      tryPersistence("find_completion_outbox", () =>
        handle.findCompletionOutbox(jobId)
      ).pipe(
        Effect.map((row): EpisodeCompletionIntent | undefined =>
          row === undefined
            ? undefined
            : (Schema.decodeUnknownSync(CompletionSchema)(
                parseJson(row.payload)
              ) as EpisodeCompletionIntent)
        )
      ),
    listPendingCompletionOutbox: (limit: number) =>
      tryPersistence("list_completion_outbox", () =>
        handle.listPendingCompletionOutbox(limit)
      ).pipe(
        Effect.map((rows) =>
          rows.map((row) => ({
            jobId: row.jobId as JobId,
            completion: Schema.decodeUnknownSync(CompletionSchema)(
              parseJson(row.payload)
            ) as EpisodeCompletionIntent,
          }))
        )
      ),
    markCompletionPublished: (jobId: JobId, publishedAt: UtcTimestamp) =>
      tryPersistence("mark_completion_published", () =>
        handle.markCompletionPublished(jobId, encodeTimestamp(publishedAt))
      ).pipe(
        Effect.flatMap((applied) =>
          applied
            ? Effect.void
            : Effect.fail(pipelineFailure("completion_outbox_missing", false))
        )
      ),
  }
}

export type SqliteExecutionRepository = ReturnType<typeof repositoryFromHandle>

export const sqliteExecutionRepository = (
  databasePath: string
): Effect.Effect<SqliteExecutionRepository, PipelineFailure, Scope.Scope> =>
  Effect.acquireRelease(
    tryPersistence("open_database", () => openSqliteJobHandle(databasePath)),
    (handle) => Effect.sync(() => handle.close())
  ).pipe(Effect.map(repositoryFromHandle))
