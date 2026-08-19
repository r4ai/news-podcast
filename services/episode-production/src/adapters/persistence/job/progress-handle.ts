import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm"

import {
  runStartedEvent,
  stateSnapshotEvent,
  stepFinishedEvent,
  stepStartedEvent,
} from "../../../application/progress/events.js"
import {
  episodeGenerationPlans,
  episodeJobArticles,
  episodeJobs,
} from "../../../../drizzle/schema.js"
import type { ProductionDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import type { JobProgressHandle, LeasedJobRow, StoredJobRow } from "./ports.js"
import { documentArticleIds, documentToRow } from "./state-columns.js"
import {
  ACTIVE_STATUSES,
  appendAgUiEvent,
  appendTransitionEvents,
  documentOfJob,
  leaseHolder,
  occurredAtOf,
  progressStateOf,
  selectJob,
  writeJobDocument,
} from "./shared.js"

/** Job lifecycle, lease fencing, and durable progress writes. */
export const makeJobProgressHandle = (
  database: ProductionDatabase
): JobProgressHandle => ({
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
      const stageStartedAt = input.phase === "started" ? input.occurredAt : null
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

  requeueRecoverableScheduled: (input) =>
    database.transaction((tx) => {
      const row = selectJob(tx).where(eq(episodeJobs.jobId, input.jobId)).get()
      if (
        row?.trigger === "scheduled" &&
        ((row.status === "Failed" &&
          row.failureCode === "no_generation_candidates") ||
          (row.status === "Canceled" &&
            row.cancelReason === "service_shutdown"))
      ) {
        writeJobDocument(tx, input.jobId, input.document)
      }
    }),

  saveIdempotently: (input) =>
    database.transaction((tx) => {
      const existing = selectJob(tx)
        .where(
          and(
            eq(episodeJobs.ownerId, input.ownerId),
            eq(episodeJobs.idempotencyScope, input.idempotencyScope),
            eq(episodeJobs.idempotencyKey, input.idempotencyKey)
          )
        )
        .get()
      if (existing !== undefined) {
        const row: StoredJobRow = {
          requestFingerprint: existing.requestFingerprint,
          document: documentOfJob(tx, existing),
        }
        return { _tag: "Existing" as const, row }
      }

      const row = documentToRow(input.document)
      tx.insert(episodeJobs)
        .values({ ...row, idempotencyScope: input.idempotencyScope })
        .run()

      const articleIds = documentArticleIds(input.document)
      if (articleIds.length > 0) {
        tx.insert(episodeJobArticles)
          .values(
            articleIds.map((articleId, position) => ({
              jobId: row.jobId,
              position,
              articleId,
            }))
          )
          .run()
      }

      appendTransitionEvents(tx, row)
      return { _tag: "Inserted" as const }
    }),

  leaseNext: (input): LeasedJobRow | undefined =>
    database.transaction((tx) => {
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

  transition: (input) =>
    database.transaction((tx) => {
      if (leaseHolder(tx, input.jobId, input.leaseToken) === undefined) {
        return false
      }
      writeJobDocument(tx, input.jobId, input.document)
      return true
    }),
})
