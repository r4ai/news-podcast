import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type {
  FeedSyncQueueError,
  FeedSyncQueueRepository,
} from "../application/feed-sync-queue.js"
import { FeedSyncJobSchema, SyncJobIdSchema } from "../domain/feed-sync.js"
import { FeedIdSchema, FeedUrlSchema } from "../domain/subscription.js"
import type { SqlitePort } from "./sqlite-port.js"

export const FEED_SYNC_MAX_ATTEMPTS = 4

const schema = `
CREATE TABLE IF NOT EXISTS feed_sync_jobs (
  job_id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feed_catalog(feed_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('Queued', 'Processing', 'Succeeded', 'Failed')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0 AND attempt <= 4),
  lease_expires_at TEXT,
  discovered INTEGER NOT NULL DEFAULT 0 CHECK(discovered >= 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived >= 0),
  failed INTEGER NOT NULL DEFAULT 0 CHECK(failed >= 0),
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(feed_id)
) STRICT;
CREATE INDEX IF NOT EXISTS feed_sync_jobs_claim
  ON feed_sync_jobs(status, created_at, job_id);
`

const RowSchema = Schema.Struct({
  jobId: Schema.String,
  feedId: Schema.String,
  feedUrl: Schema.String,
  status: Schema.String,
  attempt: Schema.Int,
  discovered: Schema.Int,
  archived: Schema.Int,
  failed: Schema.Int,
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
})
const parseRow = parse(RowSchema)

const failure = (
  operation: FeedSyncQueueError["operation"],
  reason: FeedSyncQueueError["reason"] = "Unavailable"
): FeedSyncQueueError =>
  deepFreeze({ _tag: "FeedSyncQueueFailed", operation, reason })

const select = `
SELECT job.job_id AS jobId,
       job.feed_id AS feedId,
       feed.feed_url AS feedUrl,
       job.status AS status,
       job.attempt AS attempt,
       job.discovered AS discovered,
       job.archived AS archived,
       job.failed AS failed,
       job.error AS error,
       job.created_at AS createdAt,
       job.started_at AS startedAt,
       job.completed_at AS completedAt
  FROM feed_sync_jobs job
  JOIN feed_catalog feed ON feed.feed_id = job.feed_id`

const decode = (row: unknown, operation: FeedSyncQueueError["operation"]) =>
  parseRow(row).pipe(
    Effect.flatMap((value) => {
      const { error, startedAt, completedAt, ...required } = value
      return Effect.all([
        parse(SyncJobIdSchema)(value.jobId),
        parse(FeedIdSchema)(value.feedId),
        parse(FeedUrlSchema)(value.feedUrl),
        parse(FeedSyncJobSchema)({
          ...required,
          maxAttempts: FEED_SYNC_MAX_ATTEMPTS,
          ...(error === null ? {} : { error }),
          ...(startedAt === null ? {} : { startedAt }),
          ...(completedAt === null ? {} : { completedAt }),
        }),
      ]).pipe(
        Effect.map(([jobId, feedId, feedUrl, job]) =>
          deepFreeze({
            ...job,
            jobId,
            feedId,
            feedUrl,
          })
        )
      )
    }),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const createSqliteFeedSyncQueue = (
  database: SqlitePort
): Effect.Effect<FeedSyncQueueRepository, FeedSyncQueueError> =>
  Effect.try({
    try: () => database.execute(schema),
    catch: () => failure("Initialize"),
  }).pipe(
    Effect.map(() => {
      const findByFeed = (feedId: string) =>
        database.get(`${select} WHERE job.feed_id = ?`, [feedId])

      const enqueue: FeedSyncQueueRepository["enqueue"] = (feedId, now) =>
        Effect.try({
          try: () =>
            database.transaction(() => {
              const feed = database.get(
                "SELECT feed_id FROM feed_catalog WHERE feed_id = ?",
                [feedId]
              )
              if (feed === undefined) throw new Error("feed not found")
              const current = database.get(
                "SELECT status FROM feed_sync_jobs WHERE feed_id = ?",
                [feedId]
              ) as { readonly status: string } | undefined
              if (
                current === undefined ||
                (current.status !== "Queued" && current.status !== "Processing")
              ) {
                database.run(
                  `INSERT INTO feed_sync_jobs
                     (job_id, feed_id, status, attempt, discovered, archived, failed, created_at)
                   VALUES (?, ?, 'Queued', 0, 0, 0, 0, ?)
                   ON CONFLICT(feed_id) DO UPDATE SET
                     status = 'Queued', attempt = 0, lease_expires_at = NULL,
                     discovered = 0, archived = 0, failed = 0, error = NULL,
                     created_at = excluded.created_at, started_at = NULL, completed_at = NULL`,
                  [
                    current === undefined
                      ? crypto.randomUUID()
                      : (
                          database.get(
                            "SELECT job_id FROM feed_sync_jobs WHERE feed_id = ?",
                            [feedId]
                          ) as { readonly job_id: string }
                        ).job_id,
                    feedId,
                    now,
                  ]
                )
              }
              return findByFeed(feedId)
            }),
          catch: () => failure("Enqueue"),
        }).pipe(Effect.flatMap((row) => decode(row, "Enqueue")))

      const enqueueForPolling: FeedSyncQueueRepository["enqueueForPolling"] = (
        feeds,
        now
      ) =>
        Effect.try({
          try: () =>
            database.transaction(() => {
              for (const feed of feeds) {
                const current = database.get(
                  "SELECT job_id, status, attempt FROM feed_sync_jobs WHERE feed_id = ?",
                  [feed.feedId]
                ) as
                  | {
                      readonly job_id: string
                      readonly status: string
                      readonly attempt: number
                    }
                  | undefined
                if (
                  current !== undefined &&
                  (current.status === "Queued" ||
                    current.status === "Processing")
                )
                  continue
                if (
                  current?.status === "Failed" &&
                  current.attempt >= FEED_SYNC_MAX_ATTEMPTS
                )
                  continue
                if (current === undefined) {
                  database.run(
                    `INSERT INTO feed_sync_jobs
                       (job_id, feed_id, status, attempt, discovered, archived, failed, created_at)
                     VALUES (?, ?, 'Queued', 0, 0, 0, 0, ?)`,
                    [crypto.randomUUID(), feed.feedId, now]
                  )
                } else {
                  database.run(
                    `UPDATE feed_sync_jobs
                        SET status = 'Queued', attempt = ?, lease_expires_at = NULL,
                            discovered = 0, archived = 0, failed = 0, error = NULL,
                            created_at = ?, started_at = NULL, completed_at = NULL
                      WHERE job_id = ?`,
                    [
                      current.status === "Failed" ? current.attempt : 0,
                      now,
                      current.job_id,
                    ]
                  )
                }
              }
            }),
          catch: () => failure("Enqueue"),
        }).pipe(Effect.asVoid)

      const listForOwner: FeedSyncQueueRepository["listForOwner"] = (ownerId) =>
        Effect.try({
          try: () =>
            database.all(
              `${select}
                 JOIN feed_subscriptions subscription
                   ON subscription.feed_id = job.feed_id
                WHERE subscription.owner_id = ?
                ORDER BY job.created_at DESC, job.job_id DESC`,
              [ownerId]
            ),
          catch: () => failure("List"),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) => decode(row, "List"))
          ),
          Effect.map(deepFreeze)
        )

      const claim: FeedSyncQueueRepository["claim"] = (now, leaseExpiresAt) =>
        Effect.try({
          try: () =>
            database.transaction(() => {
              database.run(
                `UPDATE feed_sync_jobs
                    SET status = 'Queued', lease_expires_at = NULL, started_at = NULL
                  WHERE status = 'Processing' AND lease_expires_at < ?`,
                [now]
              )
              const candidate = database.get(
                `${select}
                 WHERE job.status = 'Queued'
                   AND job.attempt < ?
                   AND EXISTS (
                     SELECT 1
                       FROM feed_subscriptions active_subscription
                      WHERE active_subscription.feed_id = job.feed_id
                        AND active_subscription.enabled = 1
                   )
                 ORDER BY job.created_at, job.job_id LIMIT 1`,
                [FEED_SYNC_MAX_ATTEMPTS]
              ) as { readonly jobId?: string } | undefined
              if (candidate?.jobId === undefined) return undefined
              database.run(
                `UPDATE feed_sync_jobs
                    SET status = 'Processing', attempt = attempt + 1,
                        lease_expires_at = ?, started_at = ?, error = NULL
                  WHERE job_id = ? AND status = 'Queued'`,
                [leaseExpiresAt, now, candidate.jobId]
              )
              return database.get(`${select} WHERE job.job_id = ?`, [
                candidate.jobId,
              ])
            }),
          catch: () => failure("Claim"),
        }).pipe(
          Effect.flatMap((row) =>
            row === undefined ? Effect.succeed(undefined) : decode(row, "Claim")
          )
        )

      const complete: FeedSyncQueueRepository["complete"] = (
        jobId,
        outcome,
        now
      ) =>
        Effect.try({
          try: () => {
            const status = outcome.failed > 0 ? "Failed" : "Succeeded"
            database.run(
              `UPDATE feed_sync_jobs
                  SET status = ?, lease_expires_at = NULL,
                      discovered = ?, archived = ?, failed = ?, error = ?,
                      completed_at = ?
                WHERE job_id = ?`,
              [
                status,
                outcome.discovered,
                outcome.archived,
                outcome.failed,
                outcome.error ?? null,
                now,
                jobId,
              ]
            )
            return database.get(`${select} WHERE job.job_id = ?`, [jobId])
          },
          catch: () => failure("Complete"),
        }).pipe(
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.fail(failure("Complete", "CorruptRecord"))
              : decode(row, "Complete")
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
  )
