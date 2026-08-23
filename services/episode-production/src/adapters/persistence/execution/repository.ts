import type {
  EpisodeFailureCode,
  SqliteFailureOperation,
} from "@news-podcast/contracts/episode-failure"
import { deepFreeze } from "@news-podcast/kernel"
import {
  decodePersistedJsonSync,
  isDatabaseError,
} from "@news-podcast/persistence"
import { Effect, Schema } from "effect"

import type {
  EpisodeCompletionIntent,
  EpisodeExecutionCheckpoint,
  EpisodeExecutionPorts,
  LeaseNextInput,
  LeaseToken,
  LeaseFailure,
  PipelineFailure,
  StoredAudioCheckpoint,
} from "../../../application/ports/execution.js"
import {
  GenerationPlanSchema,
  type GenerationPlan,
} from "../../../domain/generation-plan.js"
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
} from "../../../domain/episode-job.js"
import {
  ReadingDictionarySnapshotSchema,
  type ReadingDictionarySnapshot,
} from "../../../domain/reading-dictionary.js"
import type { ProductionDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { makeJobHandle } from "../job/handle.js"
import type { SqliteJobHandle } from "../job/ports.js"

const encodeJob = Schema.encodeSync(EpisodeJobSchema)
const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)

const ScriptSchema = Schema.Struct({
  title: Schema.String,
  script: Schema.String,
  sourceIndexes: Schema.Array(Schema.Int),
})
const ScriptSourceProvenanceSchema = Schema.Struct({
  sourceIndex: Schema.Int,
  articleId: Schema.String,
  snapshotId: Schema.String,
  title: Schema.String,
  url: Schema.String,
  publishedAt: Schema.optional(Schema.String),
})
const ScriptCheckpointSchema = Schema.Struct({
  script: ScriptSchema,
  sources: Schema.NonEmptyArray(ScriptSourceProvenanceSchema),
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

const pipelineFailure = (
  code: EpisodeFailureCode,
  retryable = true
): PipelineFailure => deepFreeze({ _tag: "PipelineFailure", code, retryable })
const staleLease = () => deepFreeze({ _tag: "StaleLease" as const })

const stringify = (value: unknown) => JSON.stringify(value)

const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
  operation: string,
  schema: S,
  value: string
) => decodePersistedJsonSync(operation, schema, value)

const tryPersistence = <Value>(
  operation: SqliteFailureOperation,
  run: () => Value
) =>
  Effect.try({
    try: run,
    catch: (cause) =>
      isDatabaseError(cause) && cause.reason === "CorruptRecord"
        ? pipelineFailure(`sqlite_${operation}_corrupt_record`, false)
        : pipelineFailure(`sqlite_${operation}`),
  })

const decodeGenerationPlan = (
  document: string
): Effect.Effect<GenerationPlan, PipelineFailure> =>
  tryPersistence("decode_generation_plan", () =>
    deepFreeze(
      decodeJson(
        "episode_generation_plans.plan",
        GenerationPlanSchema,
        document
      ) as GenerationPlan
    )
  )

const leaseDocument = (input: LeaseNextInput, document: string) => {
  const job = decodeJson("episode_jobs.document", EpisodeJobSchema, document)
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
    markStep: (input) =>
      tryPersistence("mark_step", () =>
        handle.markStep({
          ...input,
          occurredAt: encodeTimestamp(input.occurredAt),
        })
      ).pipe(
        Effect.flatMap((applied) =>
          applied ? Effect.void : Effect.fail(staleLease())
        )
      ),
    reportStageProgress: (input) =>
      tryPersistence("report_stage_progress", () =>
        handle.reportStageProgress({
          ...input,
          occurredAt: encodeTimestamp(input.occurredAt),
        })
      ).pipe(
        Effect.flatMap((applied) =>
          applied ? Effect.void : Effect.fail(staleLease())
        )
      ),
    recordSelectedArticles: (input) =>
      tryPersistence("record_selected_articles", () =>
        handle.recordSelectedArticles({
          ...input,
          occurredAt: encodeTimestamp(input.occurredAt),
        })
      ).pipe(
        Effect.flatMap((applied) =>
          applied ? Effect.void : Effect.fail(staleLease())
        )
      ),
    renewLease: (input) =>
      tryPersistence("renew_lease", () =>
        handle.renewLease({
          jobId: input.jobId,
          leaseToken: input.leaseToken,
          now: encodeTimestamp(input.now),
          leasedUntil: encodeTimestamp(input.leasedUntil),
        })
      ).pipe(Effect.map((applied) => (applied ? "Applied" : "StaleLease"))),
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
                ...decodeJson(
                  "episode_execution_checkpoints.script",
                  ScriptCheckpointSchema,
                  row.script
                ),
                ...(row.audio === undefined
                  ? {}
                  : {
                      audio: decodeJson(
                        "episode_execution_checkpoints.audio",
                        AudioSchema,
                        row.audio
                      ) as StoredAudioCheckpoint,
                    }),
              }) as EpisodeExecutionCheckpoint
          )
        })
      ),
    loadGenerationPlan: (jobId) =>
      tryPersistence("load_generation_plan", () =>
        handle.loadGenerationPlan(jobId)
      ).pipe(
        Effect.flatMap((document) =>
          document === undefined
            ? Effect.succeed(undefined)
            : decodeGenerationPlan(document)
        )
      ),
    listUsedAutomaticArticleIds: (ownerId) =>
      tryPersistence("list_used_automatic_articles", () =>
        handle.listUsedAutomaticArticleIds(ownerId)
      ).pipe(
        Effect.map(
          (ids) =>
            ids as readonly import("../../../domain/episode-job.js").ArticleId[]
        )
      ),
    saveGenerationPlan: (input) =>
      input.plan.jobId !== input.jobId
        ? Effect.fail(pipelineFailure("invalid_generation_plan", false))
        : tryPersistence("save_generation_plan", () =>
            handle.saveGenerationPlan({
              jobId: input.jobId,
              leaseToken: input.leaseToken,
              plan: stringify(input.plan),
            })
          ).pipe(
            Effect.flatMap(
              (
                result
              ): Effect.Effect<
                GenerationPlan,
                PipelineFailure | LeaseFailure
              > =>
                result._tag === "StaleLease"
                  ? Effect.fail(staleLease())
                  : decodeGenerationPlan(result.plan)
            )
          ),
    loadDictionarySnapshot: (jobId) =>
      tryPersistence("load_dictionary_snapshot", () =>
        handle.loadDictionarySnapshot(jobId)
      ).pipe(
        Effect.flatMap((document) =>
          document === undefined
            ? Effect.succeed(undefined)
            : tryPersistence("decode_dictionary_snapshot", () =>
                deepFreeze(
                  decodeJson(
                    "episode_dictionary_snapshots.snapshot",
                    ReadingDictionarySnapshotSchema,
                    document
                  ) as ReadingDictionarySnapshot
                )
              )
        )
      ),
    saveDictionarySnapshot: (input) =>
      tryPersistence("save_dictionary_snapshot", () =>
        handle.saveDictionarySnapshot({
          jobId: input.jobId,
          leaseToken: input.leaseToken,
          snapshot: stringify(input.snapshot),
        })
      ).pipe(
        Effect.flatMap(
          (result): Effect.Effect<void, PipelineFailure | LeaseFailure> => {
            switch (result) {
              case "Applied":
                return Effect.void
              case "StaleLease":
                return Effect.fail(staleLease())
              case "Conflict":
                return Effect.fail(
                  pipelineFailure("sqlite_dictionary_snapshot_conflict", false)
                )
            }
          }
        )
      ),
    saveScriptCheckpoint: (input) =>
      tryPersistence("save_script_checkpoint", () =>
        handle.saveScriptCheckpoint({
          jobId: input.jobId,
          leaseToken: input.leaseToken,
          script: stringify({ script: input.script, sources: input.sources }),
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
                job: decodeJson(
                  "episode_jobs.document",
                  EpisodeJobSchema,
                  row.document
                ) as RunningJob,
                recovered: row.recovered,
                readyAt: Schema.decodeUnknownSync(UtcTimestampSchema)(
                  row.readyAt
                ),
              })
        )
      ),
    checkCancellation: (input: { jobId: JobId; leaseToken: LeaseToken }) =>
      tryPersistence("check_cancellation", () =>
        handle.findById(input.jobId)
      ).pipe(
        Effect.map((document) => {
          if (document === undefined)
            return deepFreeze({ _tag: "StaleLease" as const })
          const job = decodeJson(
            "episode_jobs.document",
            EpisodeJobSchema,
            document
          )
          if (job._tag === "Canceled")
            return deepFreeze({
              _tag: "Canceled" as const,
              canceledAt: job.canceledAt,
            })
          return job._tag === "Running" && job.lease.token === input.leaseToken
            ? deepFreeze({ _tag: "Current" as const })
            : deepFreeze({ _tag: "StaleLease" as const })
        })
      ),
    findById: (jobId: JobId) =>
      tryPersistence("find_job", () => handle.findById(jobId)).pipe(
        Effect.map((document): EpisodeJob | undefined =>
          document === undefined
            ? undefined
            : decodeJson("episode_jobs.document", EpisodeJobSchema, document)
        )
      ),
    findCompletionOutbox: (jobId: JobId) =>
      tryPersistence("find_completion_outbox", () =>
        handle.findCompletionOutbox(jobId)
      ).pipe(
        Effect.map((row): EpisodeCompletionIntent | undefined =>
          row === undefined
            ? undefined
            : (decodeJson(
                "episode_completion_outbox.payload",
                CompletionSchema,
                row.payload
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
            completion: decodeJson(
              "episode_completion_outbox.payload",
              CompletionSchema,
              row.payload
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

export const executionRepository = (
  database: ProductionDatabase
): Effect.Effect<SqliteExecutionRepository, PipelineFailure> =>
  tryPersistence("open_database", () =>
    repositoryFromHandle(makeJobHandle(database))
  )
