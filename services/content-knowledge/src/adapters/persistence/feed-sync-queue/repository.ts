import { canAdmitFeed, nextReadySequence } from "./admission.js"
import { deepFreeze } from "@news-podcast/kernel"
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  lt,
  lte,
  notExists,
  sql,
} from "drizzle-orm"
import { Effect } from "effect"

import {
  feedCatalog,
  feedSubscriptions,
  feedSyncJobs,
} from "../../../../drizzle/schema.js"
import type {
  FeedSyncQueueError,
  FeedSyncQueueRepository,
} from "../../../application/feed-sync-queue.js"
import type {
  ContentKnowledgeDatabase,
  QueryRunner,
} from "../../../infrastructure/unsafe/drizzle/open.js"
import {
  decodeJob,
  decodeClaimedJob,
  failure,
  FEED_SYNC_MAX_ATTEMPTS,
  selectJobs,
} from "./row.js"

export { FEED_SYNC_MAX_ATTEMPTS }

/** 再投入時に持ち越さない実行結果。前回の計数が次回に混ざらないようにする。 */
const resetFields = (now: string) => ({
  status: "Queued" as const,
  continuationJson: null,
  readyAt: now,
  leaseToken: null,
  leaseExpiresAt: null,
  discovered: 0,
  archived: 0,
  failed: 0,
  error: null,
  createdAt: now,
  startedAt: null,
  completedAt: null,
})

const isActive = (status: string): boolean =>
  status === "Queued" || status === "Processing"

export const createFeedSyncQueue = (
  database: ContentKnowledgeDatabase,
  newJobId: () => string
): Effect.Effect<FeedSyncQueueRepository, FeedSyncQueueError> =>
  Effect.sync(() => {
    const findByFeed = (runner: QueryRunner, feedId: string) =>
      selectJobs(runner).where(eq(feedSyncJobs.feedId, feedId)).get()

    const findByJob = (runner: QueryRunner, jobId: string) =>
      selectJobs(runner).where(eq(feedSyncJobs.jobId, jobId)).get()

    const currentJob = (runner: QueryRunner, feedId: string) =>
      runner
        .select({
          jobId: feedSyncJobs.jobId,
          status: feedSyncJobs.status,
          attempt: feedSyncJobs.attempt,
          completedAt: feedSyncJobs.completedAt,
        })
        .from(feedSyncJobs)
        .where(eq(feedSyncJobs.feedId, feedId))
        .get()

    const releaseDisabled = (tx: QueryRunner, now: string) => {
      // A processing job retains its slot until completion/lease expiry.
      tx.update(feedSyncJobs)
        .set({ status: "Failed", error: "Disabled", completedAt: now })
        .where(
          and(
            eq(feedSyncJobs.status, "Queued"),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(feedSubscriptions)
                .where(
                  and(
                    eq(feedSubscriptions.feedId, feedSyncJobs.feedId),
                    eq(feedSubscriptions.enabled, 1)
                  )
                )
            )
          )
        )
        .run()
    }

    const enqueue: FeedSyncQueueRepository["enqueue"] = (feedId, now) =>
      Effect.try({
        try: () =>
          database.transaction(
            (tx) => {
              releaseDisabled(tx, now)
              const feed = tx
                .select({ feedId: feedCatalog.feedId })
                .from(feedCatalog)
                .where(eq(feedCatalog.feedId, feedId))
                .get()
              if (feed === undefined) throw new Error("feed not found")

              const current = currentJob(tx, feedId)
              // 実行中・待機中の仕事があるなら、それを重複して積まない。
              if (
                (current === undefined || !isActive(current.status)) &&
                !canAdmitFeed(tx, feedId)
              )
                throw failure("Enqueue", "ResourceLimit")
              if (current === undefined) {
                tx.insert(feedSyncJobs)
                  .values({
                    jobId: newJobId(),
                    feedId,
                    attempt: 0,
                    ...resetFields(now),
                    readySequence: nextReadySequence(tx),
                    readyAt: now,
                  })
                  .run()
              } else if (!isActive(current.status)) {
                tx.update(feedSyncJobs)
                  .set({
                    attempt: 0,
                    ...resetFields(now),
                    readySequence: nextReadySequence(tx),
                    readyAt: now,
                  })
                  .where(eq(feedSyncJobs.jobId, current.jobId))
                  .run()
              }

              return findByFeed(tx, feedId)
            },
            { behavior: "immediate" }
          ),
        catch: (error) => (isQueueError(error) ? error : failure("Enqueue")),
      }).pipe(Effect.flatMap((row) => decodeJob(row, "Enqueue")))

    const enqueueForPolling: FeedSyncQueueRepository["enqueueForPolling"] = (
      feeds,
      now
    ) =>
      Effect.try({
        try: () =>
          database.transaction(
            (tx) => {
              releaseDisabled(tx, now)
              const ordered = [...feeds].sort((a, b) => {
                const left = currentJob(tx, a.feedId)?.completedAt ?? ""
                const right = currentJob(tx, b.feedId)?.completedAt ?? ""
                return left.localeCompare(right)
              })
              for (const feed of ordered) {
                const current = currentJob(tx, feed.feedId)
                if (current !== undefined && isActive(current.status)) continue
                // 上限まで失敗した仕事は、明示的な再投入があるまで自動で蘇らせない。
                if (
                  current?.status === "Failed" &&
                  current.attempt >= FEED_SYNC_MAX_ATTEMPTS
                ) {
                  continue
                }

                if (
                  current?.status === "Succeeded" &&
                  current.completedAt !== null &&
                  Date.parse(now) - Date.parse(current.completedAt) < 300_000
                )
                  continue
                if (!canAdmitFeed(tx, feed.feedId)) continue
                if (current === undefined) {
                  tx.insert(feedSyncJobs)
                    .values({
                      jobId: newJobId(),
                      feedId: feed.feedId,
                      attempt: 0,
                      ...resetFields(now),
                      readySequence: nextReadySequence(tx),
                      readyAt: now,
                    })
                    .run()
                  continue
                }

                tx.update(feedSyncJobs)
                  .set({
                    attempt: current.status === "Failed" ? current.attempt : 0,
                    ...(current.status === "Failed"
                      ? {
                          status: "Queued" as const,
                          leaseToken: null,
                          leaseExpiresAt: null,
                          startedAt: null,
                          completedAt: null,
                        }
                      : resetFields(now)),
                    readySequence: nextReadySequence(tx),
                    readyAt: now,
                  })
                  .where(eq(feedSyncJobs.jobId, current.jobId))
                  .run()
              }
            },
            { behavior: "immediate" }
          ),
        catch: () => failure("Enqueue"),
      }).pipe(Effect.asVoid)

    const listForOwner: FeedSyncQueueRepository["listForOwner"] = (ownerId) =>
      Effect.try({
        try: () =>
          database
            .select({
              jobId: feedSyncJobs.jobId,
              feedId: feedSyncJobs.feedId,
              feedUrl: feedCatalog.feedUrl,
              status: feedSyncJobs.status,
              attempt: feedSyncJobs.attempt,
              leaseToken: feedSyncJobs.leaseToken,
              discovered: feedSyncJobs.discovered,
              archived: feedSyncJobs.archived,
              failed: feedSyncJobs.failed,
              error: feedSyncJobs.error,
              createdAt: feedSyncJobs.createdAt,
              startedAt: feedSyncJobs.startedAt,
              completedAt: feedSyncJobs.completedAt,
            })
            .from(feedSyncJobs)
            .innerJoin(feedCatalog, eq(feedCatalog.feedId, feedSyncJobs.feedId))
            .innerJoin(
              feedSubscriptions,
              eq(feedSubscriptions.feedId, feedSyncJobs.feedId)
            )
            .where(eq(feedSubscriptions.ownerId, ownerId))
            .orderBy(desc(feedSyncJobs.createdAt), desc(feedSyncJobs.jobId))
            .all(),
        catch: () => failure("List"),
      }).pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) => decodeJob(row, "List"))
        ),
        Effect.map(deepFreeze)
      )

    const claim: FeedSyncQueueRepository["claim"] = (
      now,
      leaseExpiresAt,
      leaseToken
    ) =>
      Effect.try({
        try: () =>
          database.transaction(
            (tx) => {
              // 期限切れのリースを待機中へ戻す。落ちたワーカーの仕事を回収する。
              tx.update(feedSyncJobs)
                .set({
                  status: "Queued",
                  leaseToken: null,
                  leaseExpiresAt: null,
                  startedAt: null,
                })
                .where(
                  and(
                    eq(feedSyncJobs.status, "Processing"),
                    lte(feedSyncJobs.leaseExpiresAt, now)
                  )
                )
                .run()

              tx.update(feedSyncJobs)
                .set({
                  status: "Failed",
                  error: "LeaseExpired",
                  completedAt: now,
                })
                .where(
                  and(
                    eq(feedSyncJobs.status, "Queued"),
                    eq(feedSyncJobs.attempt, FEED_SYNC_MAX_ATTEMPTS)
                  )
                )
                .run()

              releaseDisabled(tx, now)
              const candidate = tx
                .select({ jobId: feedSyncJobs.jobId })
                .from(feedSyncJobs)
                .where(
                  and(
                    eq(feedSyncJobs.status, "Queued"),
                    lt(feedSyncJobs.attempt, FEED_SYNC_MAX_ATTEMPTS),
                    exists(
                      tx
                        .select({ one: sql`1` })
                        .from(feedSubscriptions)
                        .where(
                          and(
                            eq(feedSubscriptions.feedId, feedSyncJobs.feedId),
                            eq(feedSubscriptions.enabled, 1)
                          )
                        )
                    )
                  )
                )
                .orderBy(
                  asc(feedSyncJobs.readySequence),
                  asc(feedSyncJobs.jobId)
                )
                .limit(1)
                .get()

              if (candidate === undefined) return undefined

              // status条件を付けたまま更新し、競合した取得を弾く。
              tx.update(feedSyncJobs)
                .set({
                  status: "Processing",
                  attempt: sql`${feedSyncJobs.attempt} + 1`,
                  leaseToken,
                  leaseExpiresAt,
                  startedAt: now,
                })
                .where(
                  and(
                    eq(feedSyncJobs.jobId, candidate.jobId),
                    eq(feedSyncJobs.status, "Queued")
                  )
                )
                .run()

              return findByJob(tx, candidate.jobId)
            },
            { behavior: "immediate" }
          ),
        catch: () => failure("Claim"),
      }).pipe(
        Effect.flatMap((row) =>
          row === undefined
            ? Effect.succeed(undefined)
            : decodeClaimedJob(row, "Claim")
        )
      )

    const complete: FeedSyncQueueRepository["complete"] = (
      jobId,
      leaseToken,
      outcome,
      now,
      continuation
    ) =>
      Effect.try({
        try: () =>
          database.transaction(
            (tx) => {
              const updated = tx
                .update(feedSyncJobs)
                .set({
                  status:
                    continuation !== undefined
                      ? "Queued"
                      : outcome.failed > 0 && outcome.failureScope !== "Item"
                        ? "Failed"
                        : "Succeeded",
                  leaseToken: null,
                  leaseExpiresAt: null,
                  ...(continuation === undefined
                    ? outcome.failureScope === "Feed"
                      ? {}
                      : { continuationJson: null }
                    : {
                        continuationJson: JSON.stringify(continuation),
                        readySequence: nextReadySequence(tx),
                        readyAt: now,
                        attempt: sql`${feedSyncJobs.attempt} - 1`,
                      }),
                  discovered: sql`${feedSyncJobs.discovered} + ${outcome.discovered}`,
                  archived: sql`${feedSyncJobs.archived} + ${outcome.archived}`,
                  failed: sql`${feedSyncJobs.failed} + ${outcome.failed}`,
                  error: outcome.error ?? sql`${feedSyncJobs.error}`,
                  completedAt: continuation === undefined ? now : null,
                })
                .where(
                  and(
                    eq(feedSyncJobs.jobId, jobId),
                    eq(feedSyncJobs.status, "Processing"),
                    eq(feedSyncJobs.leaseToken, leaseToken),
                    gt(feedSyncJobs.leaseExpiresAt, now)
                  )
                )
                .run()

              if (Number(updated.changes) !== 1) {
                throw failure("Complete", "StaleLease")
              }

              return findByJob(tx, jobId)
            },
            { behavior: "immediate" }
          ),
        catch: (error) =>
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "FeedSyncQueueFailed"
            ? (error as FeedSyncQueueError)
            : failure("Complete"),
      }).pipe(
        Effect.flatMap((row) =>
          row === undefined
            ? Effect.fail(failure("Complete", "CorruptRecord"))
            : decodeJob(row, "Complete")
        )
      )

    const checkpoint: FeedSyncQueueRepository["checkpoint"] = (
      jobId,
      leaseToken,
      continuation,
      now
    ) =>
      Effect.try({
        try: () => {
          const encoded = JSON.stringify(continuation)
          if (
            continuation.items.length + continuation.failures.length > 1_000 ||
            encoded.length > 4 * 1024 * 1024
          )
            throw failure("Checkpoint", "ResourceLimit")
          const updated = database
            .update(feedSyncJobs)
            .set({ continuationJson: encoded })
            .where(
              and(
                eq(feedSyncJobs.jobId, jobId),
                eq(feedSyncJobs.status, "Processing"),
                eq(feedSyncJobs.leaseToken, leaseToken),
                gt(feedSyncJobs.leaseExpiresAt, now)
              )
            )
            .run()
          if (Number(updated.changes) !== 1)
            throw failure("Checkpoint", "StaleLease")
        },
        catch: (error) => (isQueueError(error) ? error : failure("Checkpoint")),
      })

    return deepFreeze({
      checkpoint,
      enqueue,
      enqueueForPolling,
      listForOwner,
      claim,
      complete,
    })
  })

const isQueueError = (error: unknown): error is FeedSyncQueueError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "FeedSyncQueueFailed"
