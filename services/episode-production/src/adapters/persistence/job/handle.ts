import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm"

import {
  episodeCompletionOutbox,
  episodeDictionarySnapshots,
  episodeExecutionCheckpoints,
  episodeJobArticles,
  episodeJobs,
  episodeJobStatusEvents,
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
  StoredJobStatusEventRow,
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
    .select({ status: episodeJobs.status })
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
    })
    .where(eq(episodeJobs.jobId, jobId))
    .run()

  // 状態が変わったときだけ記録する。トリガのWHEN句と同じ条件。
  if (previous !== undefined && previous.status !== row.status) {
    appendStatusEvent(runner, row, document)
  }
}

const appendStatusEvent = (
  runner: QueryRunner,
  row: EpisodeJobRow,
  document: string
): void => {
  runner
    .insert(episodeJobStatusEvents)
    .values({
      jobId: row.jobId,
      ownerId: row.ownerId,
      status: row.status,
      occurredAt:
        row.enqueuedAt ??
        row.startedAt ??
        row.retryAt ??
        row.completedAt ??
        row.failedAt ??
        row.canceledAt ??
        row.createdAt,
      document,
    })
    .run()
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

    listOwnedStatusEvents: (input): readonly StoredJobStatusEventRow[] =>
      database
        .select({
          sequence: episodeJobStatusEvents.sequence,
          document: episodeJobStatusEvents.document,
        })
        .from(episodeJobStatusEvents)
        .where(
          and(
            eq(episodeJobStatusEvents.ownerId, input.ownerId),
            eq(episodeJobStatusEvents.jobId, input.jobId),
            gt(episodeJobStatusEvents.sequence, input.afterSequence)
          )
        )
        .orderBy(asc(episodeJobStatusEvents.sequence))
        .limit(input.limit)
        .all(),

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

        // 生成直後の状態も遷移の一部として記録する。
        appendStatusEvent(database, row, input.document)
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
