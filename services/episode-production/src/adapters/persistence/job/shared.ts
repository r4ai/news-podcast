import { and, asc, eq } from "drizzle-orm"

import {
  runErrorEvent,
  runFinishedEvent,
  runStartedEvent,
  stateSnapshotEvent,
} from "../../../application/progress/events.js"
import type {
  DurableAgUiEvent,
  ProgressState,
} from "../../../application/progress/model.js"
import {
  episodeGenerationPlans,
  episodeJobArticles,
  episodeJobs,
  episodeJobAguiEvents,
} from "../../../../drizzle/schema.js"
import type { QueryRunner } from "../../../infrastructure/unsafe/drizzle/open.js"
import {
  documentToRow,
  rowToDocument,
  type EpisodeJobRow,
} from "./state-columns.js"

/** 実行が進行しうる状態。ここに無い状態は終端で、もう遷移しない。 */
export const ACTIVE_STATUSES = ["Queued", "Running", "Retrying"] as const

export const selectJob = (runner: QueryRunner) =>
  runner.select().from(episodeJobs)

export const articleIdsOf = (
  runner: QueryRunner,
  jobId: string
): readonly string[] =>
  runner
    .select({ articleId: episodeJobArticles.articleId })
    .from(episodeJobArticles)
    .where(eq(episodeJobArticles.jobId, jobId))
    .orderBy(asc(episodeJobArticles.position))
    .all()
    .map((row) => row.articleId)

export const documentOfJob = (
  runner: QueryRunner,
  row: EpisodeJobRow
): string => rowToDocument(row, articleIdsOf(runner, row.jobId))

export const occurredAtOf = (row: EpisodeJobRow): string =>
  row.enqueuedAt ??
  row.startedAt ??
  row.retryAt ??
  row.completedAt ??
  row.failedAt ??
  row.canceledAt ??
  row.createdAt

export const progressStateOf = (
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

export const appendAgUiEvent = (
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

export const appendTransitionEvents = (
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
      row.status === "Queued" && previousStatus !== undefined
        ? `${row.jobId}:state:${row.status}:${row.attempt}:${row.enqueuedAt}`
        : `${row.jobId}:state:${row.status}:${row.attempt}`
    )
  )
  if (row.status === "Succeeded")
    appendAgUiEvent(runner, row, runFinishedEvent(state, at))
}

/** 状態遷移とdurable progress eventを同じtransactionへ書き込む。 */
export const writeJobDocument = (
  runner: QueryRunner,
  jobId: string,
  document: string
): void => {
  const row = documentToRow(document)
  const previous = selectJob(runner).where(eq(episodeJobs.jobId, jobId)).get()

  runner
    .update(episodeJobs)
    .set({
      createdAt: row.createdAt,
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
      stageStartedAt: row.stageStartedAt,
      lastProgressAt: row.lastProgressAt,
      stageProgressCompleted: row.stageProgressCompleted,
      stageProgressTotal: row.stageProgressTotal,
    })
    .where(eq(episodeJobs.jobId, jobId))
    .run()

  const updated = selectJob(runner).where(eq(episodeJobs.jobId, jobId)).get()
  if (updated !== undefined)
    appendTransitionEvents(runner, updated, previous?.status)
}

export const leaseHolder = (
  runner: QueryRunner,
  jobId: string,
  leaseToken: string
) =>
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
