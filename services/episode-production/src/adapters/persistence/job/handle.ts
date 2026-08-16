import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm"

import {
  runErrorEvent,
  runFinishedEvent,
  runStartedEvent,
  stateSnapshotEvent,
  stepFinishedEvent,
  stepStartedEvent,
} from "../../../application/progress/events.js"
import type {
  DurableAgUiEvent,
  ProgressState,
} from "../../../application/progress/model.js"
import {
  episodeCompletionOutbox,
  episodeDictionarySnapshots,
  episodeExecutionCheckpoints,
  episodeGenerationPlans,
  episodeJobArticles,
  episodeJobs,
  episodeJobAguiEvents,
} from "../../../../drizzle/schema.js"
import type {
  ProductionDatabase,
  QueryRunner,
} from "../../../infrastructure/unsafe/drizzle/open.js"
import {
  documentArticleIds,
  documentToRow,
  rowToDocument,
  type EpisodeJobRow,
} from "./state-columns.js"
import type {
  LeasedJobRow,
  SqliteJobHandle,
  SqliteJobStatusSnapshot,
  StoredCheckpointRow,
  StoredCompletionOutboxRow,
  StoredJobRow,
  StoredJobAgUiEventRow,
} from "./ports.js"

/** 実行が進行しうる状態。ここに無い状態は終端で、もう遷移しない。 */
const ACTIVE_STATUSES = ["Queued", "Running", "Retrying"] as const

const selectJob = (runner: QueryRunner) => runner.select().from(episodeJobs)

const articleIdsOf = (runner: QueryRunner, jobId: string): readonly string[] =>
  runner
    .select({ articleId: episodeJobArticles.articleId })
    .from(episodeJobArticles)
    .where(eq(episodeJobArticles.jobId, jobId))
    .orderBy(asc(episodeJobArticles.position))
    .all()
    .map((row) => row.articleId)

const documentOfJob = (runner: QueryRunner, row: EpisodeJobRow): string =>
  rowToDocument(row, articleIdsOf(runner, row.jobId))

const occurredAtOf = (row: EpisodeJobRow): string =>
  row.enqueuedAt ??
  row.startedAt ??
  row.retryAt ??
  row.completedAt ??
  row.failedAt ??
  row.canceledAt ??
  row.createdAt

const progressStateOf = (
  runner: QueryRunner,
  row: EpisodeJobRow
): ProgressState => {
  const plan = runner
    .select({
      selectionMode: episodeGenerationPlans.selectionMode,
      selectedArticleIds: episodeGenerationPlans.selectedArticleIds,
      selectedArticles: episodeGenerationPlans.selectedArticles,
    })
    .from(episodeGenerationPlans)
    .where(eq(episodeGenerationPlans.jobId, row.jobId))
    .get()
  const requestedIds = articleIdsOf(runner, row.jobId)
  const plannedArticles =
    plan === undefined
      ? requestedIds.map((articleId) => ({ articleId }))
      : (JSON.parse(plan.selectedArticles) as readonly Readonly<{
          articleId: string
          title: string
          sourceName: string
        }>[])
  const selectedArticles =
    plannedArticles.length > 0
      ? plannedArticles
      : (JSON.parse(plan?.selectedArticleIds ?? "[]") as readonly string[]).map(
          (articleId) => ({ articleId })
        )
  const status = row.status.toLowerCase() as ProgressState["status"]
  return {
    jobId: row.jobId,
    status,
    attempt: row.attempt,
    maxAttempts: 4,
    selectionMode:
      plan?.selectionMode ?? (requestedIds.length > 0 ? "manual" : "automatic"),
    selectedArticles,
    ...(row.currentStage == null ? {} : { currentStage: row.currentStage }),
    ...(row.stageProgressCompleted == null || row.stageProgressTotal == null
      ? {}
      : {
          stageProgress: {
            completed: row.stageProgressCompleted,
            total: row.stageProgressTotal,
          },
        }),
    ...(row.failureCode === null
      ? {}
      : {
          failure: {
            code: row.failureCode,
            message:
              row.failureRetryable === 1
                ? "Episode generation will be retried"
                : "Episode generation failed",
            retryable: row.failureRetryable === 1,
          },
        }),
    ...(row.episodeId === null ? {} : { episodeId: row.episodeId }),
  }
}

const appendAgUiEvent = (
  runner: QueryRunner,
  row: EpisodeJobRow,
  event: DurableAgUiEvent
): void => {
  runner
    .insert(episodeJobAguiEvents)
    .values({
      jobId: row.jobId,
      ownerId: row.ownerId,
      runId: event.runId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payload: event.payload,
      eventKey: event.eventKey,
    })
    .onConflictDoNothing({ target: episodeJobAguiEvents.eventKey })
    .run()
}

const appendTransitionEvents = (
  runner: QueryRunner,
  row: EpisodeJobRow,
  previousStatus?: EpisodeJobRow["status"]
): void => {
  if (previousStatus === row.status) return
  const at = occurredAtOf(row)
  const state = progressStateOf(runner, row)
  if (row.status === "Running")
    appendAgUiEvent(runner, row, runStartedEvent(state, at))
  if (
    row.status === "Retrying" ||
    row.status === "Failed" ||
    row.status === "Canceled"
  ) {
    appendAgUiEvent(
      runner,
      row,
      runErrorEvent(state, at, {
        code:
          row.failureCode ??
          (row.status === "Canceled" ? "canceled" : "unknown"),
        retryable: row.status === "Retrying",
      })
    )
  }
  appendAgUiEvent(
    runner,
    row,
    stateSnapshotEvent(
      state,
      at,
      `${row.jobId}:state:${row.status}:${row.attempt}`
    )
  )
  if (row.status === "Succeeded")
    appendAgUiEvent(runner, row, runFinishedEvent(state, at))
}

/**
 * 状態遷移を書き込むと同時に、状態イベントを積む。
 * 以前はトリガが担っていたが、書く側が明示的に責任を持つ。
 */
const writeJobDocument = (
  runner: QueryRunner,
  jobId: string,
  document: string
): void => {
  const row = documentToRow(document)
  const previous = runner
    .select()
    .from(episodeJobs)
    .where(eq(episodeJobs.jobId, jobId))
    .get()

  runner
    .update(episodeJobs)
    .set({
      status: row.status,
      attempt: row.attempt,
      enqueuedAt: row.enqueuedAt,
      startedAt: row.startedAt,
      retryAt: row.retryAt,
      completedAt: row.completedAt,
      failedAt: row.failedAt,
      canceledAt: row.canceledAt,
      leaseToken: row.leaseToken,
      leasedUntil: row.leasedUntil,
      failureCode: row.failureCode,
      failureRetryable: row.failureRetryable,
      episodeId: row.episodeId,
      cancelReason: row.cancelReason,
      currentStage:
        row.status === "Running" ? (previous?.currentStage ?? null) : null,
    })
    .where(eq(episodeJobs.jobId, jobId))
    .run()

  const updated = selectJob(runner).where(eq(episodeJobs.jobId, jobId)).get()
  if (updated !== undefined)
    appendTransitionEvents(runner, updated, previous?.status)
}

const leaseHolder = (runner: QueryRunner, jobId: string, leaseToken: string) =>
  runner
    .select({ jobId: episodeJobs.jobId })
    .from(episodeJobs)
    .where(
      and(
        eq(episodeJobs.jobId, jobId),
        eq(episodeJobs.status, "Running"),
        eq(episodeJobs.leaseToken, leaseToken)
      )
    )
    .get()

export const makeJobHandle = (
  database: ProductionDatabase
): SqliteJobHandle => {
  const findById = (jobId: string): string | undefined => {
    const row = selectJob(database).where(eq(episodeJobs.jobId, jobId)).get()
    return row === undefined ? undefined : documentOfJob(database, row)
  }

  const findOwned = (ownerId: string, jobId: string): string | undefined => {
    const row = selectJob(database)
      .where(
        and(eq(episodeJobs.ownerId, ownerId), eq(episodeJobs.jobId, jobId))
      )
      .get()
    return row === undefined ? undefined : documentOfJob(database, row)
  }

  return {
    findById,
    findOwned,

    listOwned: (ownerId, limit) =>
      selectJob(database)
        .where(eq(episodeJobs.ownerId, ownerId))
        .orderBy(desc(episodeJobs.createdAt), desc(episodeJobs.jobId))
        .limit(limit)
        .all()
        .map((row) => documentOfJob(database, row)),

    statusSnapshot: (): readonly SqliteJobStatusSnapshot[] =>
      database
        .select({
          status: episodeJobs.status,
          count: sql<number>`COUNT(*)`.as("count"),
          // 進行中の状態だけが「滞留の古さ」を持つ。
          oldestActiveAt: sql<string | null>`MIN(
            CASE ${episodeJobs.status}
              WHEN 'Queued' THEN ${episodeJobs.enqueuedAt}
              WHEN 'Retrying' THEN ${episodeJobs.retryAt}
              WHEN 'Running' THEN ${episodeJobs.startedAt}
            END
          )`.as("oldestActiveAt"),
        })
        .from(episodeJobs)
        .groupBy(episodeJobs.status)
        .orderBy(asc(episodeJobs.status))
        .all()
        .map((row) => ({
          status: row.status.toLowerCase(),
          count: Number(row.count),
          ...(row.oldestActiveAt === null
            ? {}
            : { oldestActiveAt: row.oldestActiveAt }),
        })),

    listOwnedAgUiEvents: (input): readonly StoredJobAgUiEventRow[] =>
      database
        .select({
          sequence: episodeJobAguiEvents.sequence,
          payload: episodeJobAguiEvents.payload,
        })
        .from(episodeJobAguiEvents)
        .where(
          and(
            eq(episodeJobAguiEvents.ownerId, input.ownerId),
            eq(episodeJobAguiEvents.jobId, input.jobId),
            gt(episodeJobAguiEvents.sequence, input.afterSequence)
          )
        )
        .orderBy(asc(episodeJobAguiEvents.sequence))
        .limit(input.limit)
        .all(),

    markStep: (input) =>
      database.transaction((tx) => {
        const row = selectJob(tx)
          .where(
            and(
              eq(episodeJobs.jobId, input.jobId),
              eq(episodeJobs.status, "Running"),
              eq(episodeJobs.leaseToken, input.leaseToken)
            )
          )
          .get()
        if (row === undefined) return false
        const currentStage = input.phase === "started" ? input.step : null
        const stageStartedAt =
          input.phase === "started" ? input.occurredAt : null
        tx.update(episodeJobs)
          .set({
            currentStage,
            stageStartedAt,
            lastProgressAt: input.occurredAt,
            stageProgressCompleted: null,
            stageProgressTotal: null,
          })
          .where(eq(episodeJobs.jobId, input.jobId))
          .run()
        const updated = {
          ...row,
          currentStage,
          stageStartedAt,
          lastProgressAt: input.occurredAt,
          stageProgressCompleted: null,
          stageProgressTotal: null,
        }
        const state = progressStateOf(tx, updated)
        appendAgUiEvent(
          tx,
          updated,
          input.phase === "started"
            ? stepStartedEvent(state, input.step, input.occurredAt)
            : stepFinishedEvent(state, input.step, input.occurredAt)
        )
        appendAgUiEvent(
          tx,
          updated,
          stateSnapshotEvent(
            state,
            input.occurredAt,
            `${input.jobId}:run:${row.attempt}:step:${input.step}:${input.phase}:state`
          )
        )
        return true
      }),

    reportStageProgress: (input) =>
      database.transaction((tx) => {
        if (
          !Number.isSafeInteger(input.completed) ||
          !Number.isSafeInteger(input.total) ||
          input.completed < 0 ||
          input.total <= 0 ||
          input.completed > input.total
        )
          return false
        const row = selectJob(tx)
          .where(
            and(
              eq(episodeJobs.jobId, input.jobId),
              eq(episodeJobs.status, "Running"),
              eq(episodeJobs.leaseToken, input.leaseToken),
              eq(episodeJobs.currentStage, input.step)
            )
          )
          .get()
        if (row === undefined) return false
        if (
          row.stageProgressCompleted !== null &&
          input.completed <= row.stageProgressCompleted
        )
          return true
        tx.update(episodeJobs)
          .set({
            lastProgressAt: input.occurredAt,
            stageProgressCompleted: input.completed,
            stageProgressTotal: input.total,
          })
          .where(eq(episodeJobs.jobId, input.jobId))
          .run()
        const updated = {
          ...row,
          lastProgressAt: input.occurredAt,
          stageProgressCompleted: input.completed,
          stageProgressTotal: input.total,
        }
        appendAgUiEvent(
          tx,
          updated,
          stateSnapshotEvent(
            progressStateOf(tx, updated),
            input.occurredAt,
            `${input.jobId}:run:${row.attempt}:step:${input.step}:progress:${input.completed}:${input.total}`
          )
        )
        return true
      }),

    recordSelectedArticles: (input) =>
      database.transaction((tx) => {
        const row = selectJob(tx)
          .where(
            and(
              eq(episodeJobs.jobId, input.jobId),
              eq(episodeJobs.status, "Running"),
              eq(episodeJobs.leaseToken, input.leaseToken)
            )
          )
          .get()
        if (row === undefined) return false
        const changed = tx
          .update(episodeGenerationPlans)
          .set({ selectedArticles: JSON.stringify(input.articles) })
          .where(eq(episodeGenerationPlans.jobId, input.jobId))
          .run().changes
        if (Number(changed) !== 1) return false
        appendAgUiEvent(
          tx,
          row,
          stateSnapshotEvent(
            progressStateOf(tx, row),
            input.occurredAt,
            `${input.jobId}:run:${row.attempt}:articles:materialized`
          )
        )
        return true
      }),

    replaceOwnedActive: (input) =>
      database.transaction((tx) => {
        const row = selectJob(tx)
          .where(
            and(
              eq(episodeJobs.ownerId, input.ownerId),
              eq(episodeJobs.jobId, input.jobId)
            )
          )
          .get()
        if (row === undefined) return { _tag: "NotFound" as const }
        if (!ACTIVE_STATUSES.includes(row.status as never)) {
          return { _tag: "Terminal" as const }
        }
        const document = input.replace(documentOfJob(tx, row))
        writeJobDocument(tx, input.jobId, document)
        return { _tag: "Updated" as const, document }
      }),

    saveIdempotently: (input) =>
      database.transaction(() => {
        const existing = selectJob(database)
          .where(
            and(
              eq(episodeJobs.ownerId, input.ownerId),
              eq(episodeJobs.idempotencyKey, input.idempotencyKey)
            )
          )
          .get()
        if (existing !== undefined) {
          const row: StoredJobRow = {
            requestFingerprint: existing.requestFingerprint,
            document: documentOfJob(database, existing),
          }
          return { _tag: "Existing" as const, row }
        }

        const row = documentToRow(input.document)
        database.insert(episodeJobs).values(row).run()

        const articleIds = documentArticleIds(input.document)
        if (articleIds.length > 0) {
          database
            .insert(episodeJobArticles)
            .values(
              articleIds.map((articleId, position) => ({
                jobId: row.jobId,
                position,
                articleId,
              }))
            )
            .run()
        }

        appendTransitionEvents(database, row)
        return { _tag: "Inserted" as const }
      }),

    leaseNext: (input): LeasedJobRow | undefined =>
      database.transaction((tx) => {
        // 期限切れのリースは回収を優先し、次に再試行期限の到来したもの。
        const candidate = selectJob(tx)
          .where(
            or(
              eq(episodeJobs.status, "Queued"),
              and(
                eq(episodeJobs.status, "Retrying"),
                lte(episodeJobs.retryAt, input.now)
              ),
              and(
                eq(episodeJobs.status, "Running"),
                lte(episodeJobs.leasedUntil, input.now)
              )
            )
          )
          .orderBy(
            sql`CASE ${episodeJobs.status}
                  WHEN 'Running' THEN 0
                  WHEN 'Retrying' THEN 1
                  ELSE 2
                END`,
            asc(episodeJobs.jobId)
          )
          .limit(1)
          .get()
        if (candidate === undefined) return undefined

        const recovered = candidate.status === "Running"
        const next = input.replace(documentOfJob(tx, candidate))
        writeJobDocument(tx, candidate.jobId, next)
        if (recovered) {
          const recoveredRow = selectJob(tx)
            .where(eq(episodeJobs.jobId, candidate.jobId))
            .get()
          if (recoveredRow !== undefined) {
            const at = occurredAtOf(recoveredRow)
            const state = progressStateOf(tx, recoveredRow)
            appendAgUiEvent(tx, recoveredRow, runStartedEvent(state, at))
            appendAgUiEvent(
              tx,
              recoveredRow,
              stateSnapshotEvent(
                state,
                at,
                `${candidate.jobId}:run:${recoveredRow.attempt}:recovered:${at}:state`
              )
            )
          }
        }
        return { document: next, recovered }
      }),

    hasLease: (jobId, leaseToken) =>
      leaseHolder(database, jobId, leaseToken) !== undefined,

    renewLease: (input) =>
      Number(
        database
          .update(episodeJobs)
          .set({ leasedUntil: input.leasedUntil })
          .where(
            and(
              eq(episodeJobs.jobId, input.jobId),
              eq(episodeJobs.status, "Running"),
              eq(episodeJobs.leaseToken, input.leaseToken),
              gt(episodeJobs.leasedUntil, input.now)
            )
          )
          .run().changes
      ) === 1,

    loadCheckpoint: (jobId): StoredCheckpointRow | undefined => {
      const row = database
        .select()
        .from(episodeExecutionCheckpoints)
        .where(eq(episodeExecutionCheckpoints.jobId, jobId))
        .get()
      return row === undefined
        ? undefined
        : {
            script: row.script,
            ...(row.audio === null ? {} : { audio: row.audio }),
          }
    },

    loadGenerationPlan: (jobId) => {
      const row = database
        .select()
        .from(episodeGenerationPlans)
        .where(eq(episodeGenerationPlans.jobId, jobId))
        .get()
      return row === undefined
        ? undefined
        : JSON.stringify({
            jobId: row.jobId,
            ownerId: row.ownerId,
            selectionMode: row.selectionMode,
            interestProfile: {
              include: row.profileInclude,
              exclude: row.profileExclude,
            },
            selectedArticleIds: JSON.parse(row.selectedArticleIds) as unknown,
            model: row.model,
            createdAt: row.createdAt,
          })
    },

    listUsedAutomaticArticleIds: (ownerId) => {
      const rows = database
        .select({ articleIds: episodeGenerationPlans.selectedArticleIds })
        .from(episodeGenerationPlans)
        .innerJoin(
          episodeJobs,
          eq(episodeJobs.jobId, episodeGenerationPlans.jobId)
        )
        .where(
          and(
            eq(episodeGenerationPlans.ownerId, ownerId),
            eq(episodeGenerationPlans.selectionMode, "automatic"),
            eq(episodeJobs.status, "Succeeded")
          )
        )
        .all()
      return [
        ...new Set(
          rows.flatMap((row) => JSON.parse(row.articleIds) as readonly string[])
        ),
      ]
    },

    saveGenerationPlan: (input) =>
      database.transaction((tx) => {
        if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
          return { _tag: "StaleLease" as const }
        }
        const plan = JSON.parse(input.plan) as {
          ownerId: string
          selectionMode: "automatic" | "manual"
          interestProfile: { include: string; exclude: string }
          selectedArticleIds: readonly string[]
          model: string
          createdAt: string
        }
        tx.insert(episodeGenerationPlans)
          .values({
            jobId: input.jobId,
            ownerId: plan.ownerId,
            selectionMode: plan.selectionMode,
            profileInclude: plan.interestProfile.include,
            profileExclude: plan.interestProfile.exclude,
            selectedArticleIds: JSON.stringify(plan.selectedArticleIds),
            model: plan.model,
            createdAt: plan.createdAt,
          })
          .onConflictDoNothing({ target: episodeGenerationPlans.jobId })
          .run()
        const stored = tx
          .select()
          .from(episodeGenerationPlans)
          .where(eq(episodeGenerationPlans.jobId, input.jobId))
          .get()
        if (stored === undefined) throw new Error("generation plan missing")
        return {
          _tag: "Stored" as const,
          plan: JSON.stringify({
            jobId: stored.jobId,
            ownerId: stored.ownerId,
            selectionMode: stored.selectionMode,
            interestProfile: {
              include: stored.profileInclude,
              exclude: stored.profileExclude,
            },
            selectedArticleIds: JSON.parse(
              stored.selectedArticleIds
            ) as unknown,
            model: stored.model,
            createdAt: stored.createdAt,
          }),
        }
      }),

    loadDictionarySnapshot: (jobId) =>
      database
        .select({ snapshot: episodeDictionarySnapshots.snapshot })
        .from(episodeDictionarySnapshots)
        .where(eq(episodeDictionarySnapshots.jobId, jobId))
        .get()?.snapshot,

    saveDictionarySnapshot: (input) =>
      database.transaction((tx) => {
        if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
          return "StaleLease" as const
        }
        // 最初に書かれた辞書を確定とし、後続の差し替えは衝突として扱う。
        tx.insert(episodeDictionarySnapshots)
          .values({ jobId: input.jobId, snapshot: input.snapshot })
          .onConflictDoNothing({ target: episodeDictionarySnapshots.jobId })
          .run()
        const stored = tx
          .select({ snapshot: episodeDictionarySnapshots.snapshot })
          .from(episodeDictionarySnapshots)
          .where(eq(episodeDictionarySnapshots.jobId, input.jobId))
          .get()
        return stored?.snapshot === input.snapshot
          ? ("Applied" as const)
          : ("Conflict" as const)
      }),

    saveScriptCheckpoint: (input) =>
      database.transaction((tx) => {
        if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
          return false
        }
        tx.insert(episodeExecutionCheckpoints)
          .values({ jobId: input.jobId, script: input.script, audio: null })
          .onConflictDoUpdate({
            target: episodeExecutionCheckpoints.jobId,
            set: { script: input.script },
          })
          .run()
        return true
      }),

    saveAudioCheckpoint: (input) =>
      database.transaction((tx) => {
        if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
          return "StaleLease" as const
        }
        // 台本の記録が無ければ音声だけを残さない。
        return Number(
          tx
            .update(episodeExecutionCheckpoints)
            .set({ audio: input.audio })
            .where(eq(episodeExecutionCheckpoints.jobId, input.jobId))
            .run().changes
        ) === 1
          ? ("Applied" as const)
          : ("MissingScript" as const)
      }),

    transition: (input) =>
      database.transaction((tx) => {
        if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
          return false
        }
        writeJobDocument(tx, input.jobId, input.document)
        return true
      }),

    completeWithOutbox: (input) =>
      database.transaction((tx) => {
        const current = selectJob(tx)
          .where(eq(episodeJobs.jobId, input.jobId))
          .get()
        const existing = tx
          .select({
            episodeId: episodeCompletionOutbox.episodeId,
            payload: episodeCompletionOutbox.payload,
          })
          .from(episodeCompletionOutbox)
          .where(eq(episodeCompletionOutbox.jobId, input.jobId))
          .get()

        // 同じ完了を二度書かない。再送は成功として受け流す。
        if (
          current?.status === "Succeeded" &&
          current.episodeId === input.episodeId &&
          existing?.episodeId === input.episodeId &&
          existing.payload === input.payload
        ) {
          return "Duplicate" as const
        }

        if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
          return "StaleLease" as const
        }

        writeJobDocument(tx, input.jobId, input.document)
        tx.insert(episodeCompletionOutbox)
          .values({
            jobId: input.jobId,
            episodeId: input.episodeId,
            payload: input.payload,
            createdAt: input.createdAt,
            publishedAt: null,
          })
          .run()
        return "Applied" as const
      }),

    findCompletionOutbox: (jobId): StoredCompletionOutboxRow | undefined =>
      database
        .select({
          episodeId: episodeCompletionOutbox.episodeId,
          payload: episodeCompletionOutbox.payload,
        })
        .from(episodeCompletionOutbox)
        .where(eq(episodeCompletionOutbox.jobId, jobId))
        .get(),

    listPendingCompletionOutbox: (limit) =>
      database
        .select({
          jobId: episodeCompletionOutbox.jobId,
          episodeId: episodeCompletionOutbox.episodeId,
          payload: episodeCompletionOutbox.payload,
        })
        .from(episodeCompletionOutbox)
        .where(isNull(episodeCompletionOutbox.publishedAt))
        .orderBy(
          asc(episodeCompletionOutbox.createdAt),
          asc(episodeCompletionOutbox.jobId)
        )
        .limit(limit)
        .all(),

    markCompletionPublished: (jobId, publishedAt) =>
      Number(
        database
          .update(episodeCompletionOutbox)
          .set({ publishedAt })
          .where(
            and(
              eq(episodeCompletionOutbox.jobId, jobId),
              isNull(episodeCompletionOutbox.publishedAt)
            )
          )
          .run().changes
      ) === 1,

    close: () => {
      // 接続はサービスプロセスが所有する。ハンドルは閉じない。
    },
  }
}

export { ACTIVE_STATUSES }
export type { SqliteJobHandle }
