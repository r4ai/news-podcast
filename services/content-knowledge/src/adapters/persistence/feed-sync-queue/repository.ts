import { deepFreeze } from "@news-podcast/kernel"
import { and, asc, desc, eq, exists, lt, sql } from "drizzle-orm"
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
        })
        .from(feedSyncJobs)
        .where(eq(feedSyncJobs.feedId, feedId))
        .get()

    const enqueue: FeedSyncQueueRepository["enqueue"] = (feedId, now) =>
      Effect.try({
        try: () =>
          database.transaction((tx) => {
            const feed = tx
              .select({ feedId: feedCatalog.feedId })
              .from(feedCatalog)
              .where(eq(feedCatalog.feedId, feedId))
              .get()
            if (feed === undefined) throw new Error("feed not found")

            const current = currentJob(tx, feedId)
            // 実行中・待機中の仕事があるなら、それを重複して積まない。
            if (current === undefined) {
              tx.insert(feedSyncJobs)
                .values({
                  jobId: newJobId(),
                  feedId,
                  attempt: 0,
                  ...resetFields(now),
                })
                .run()
            } else if (!isActive(current.status)) {
              tx.update(feedSyncJobs)
                .set({ attempt: 0, ...resetFields(now) })
                .where(eq(feedSyncJobs.jobId, current.jobId))
                .run()
            }

            return findByFeed(tx, feedId)
          }),
        catch: () => failure("Enqueue"),
      }).pipe(Effect.flatMap((row) => decodeJob(row, "Enqueue")))

    const enqueueForPolling: FeedSyncQueueRepository["enqueueForPolling"] = (
      feeds,
      now
    ) =>
      Effect.try({
        try: () =>
          database.transaction((tx) => {
            for (const feed of feeds) {
              const current = currentJob(tx, feed.feedId)
              if (current !== undefined && isActive(current.status)) continue
              // 上限まで失敗した仕事は、明示的な再投入があるまで自動で蘇らせない。
              if (
                current?.status === "Failed" &&
                current.attempt >= FEED_SYNC_MAX_ATTEMPTS
              ) {
                continue
              }

              if (current === undefined) {
                tx.insert(feedSyncJobs)
                  .values({
                    jobId: newJobId(),
                    feedId: feed.feedId,
                    attempt: 0,
                    ...resetFields(now),
                  })
                  .run()
                continue
              }

              tx.update(feedSyncJobs)
                .set({
                  attempt: current.status === "Failed" ? current.attempt : 0,
                  ...resetFields(now),
                })
                .where(eq(feedSyncJobs.jobId, current.jobId))
                .run()
            }
          }),
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
          database.transaction((tx) => {
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
                  lt(feedSyncJobs.leaseExpiresAt, now)
                )
              )
              .run()

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
              .orderBy(asc(feedSyncJobs.createdAt), asc(feedSyncJobs.jobId))
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
                error: null,
              })
              .where(
                and(
                  eq(feedSyncJobs.jobId, candidate.jobId),
                  eq(feedSyncJobs.status, "Queued")
                )
              )
              .run()

            return findByJob(tx, candidate.jobId)
          }),
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
      now
    ) =>
      Effect.try({
        try: () => {
          const updated = database
            .update(feedSyncJobs)
            .set({
              status: outcome.failed > 0 ? "Failed" : "Succeeded",
              leaseToken: null,
              leaseExpiresAt: null,
              discovered: outcome.discovered,
              archived: outcome.archived,
              failed: outcome.failed,
              error: outcome.error ?? null,
              completedAt: now,
            })
            .where(
              and(
                eq(feedSyncJobs.jobId, jobId),
                eq(feedSyncJobs.status, "Processing"),
                eq(feedSyncJobs.leaseToken, leaseToken)
              )
            )
            .run()

          if (Number(updated.changes) !== 1) {
            throw failure("Complete", "StaleLease")
          }

          return findByJob(database, jobId)
        },
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

    return deepFreeze({
      enqueue,
      enqueueForPolling,
      listForOwner,
      claim,
      complete,
    })
  })
