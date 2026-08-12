import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type {
  EnqueueEnrichmentResult,
  EnrichmentQueueError,
  EnrichmentQueueRepository,
  EnrichmentQueueStatus,
} from "../application/enrichment.js"
import { ENRICHMENT_MAX_ATTEMPTS } from "../domain/enrichment.js"
import {
  EnrichmentQueueItemSchema,
  EnrichmentTargetSchema,
} from "../domain/enrichment.js"
import { OwnerIdSchema } from "../domain/subscription.js"
import { contentTaxonomySchema } from "./sqlite-content-taxonomy.js"
import type { SqlitePort } from "./sqlite-port.js"

const NEW_PRIORITY = 0
const REPROCESS_PRIORITY = 100

const schema = `
${contentTaxonomySchema}
CREATE TABLE IF NOT EXISTS content_enrichment_results (
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('Succeeded', 'Failed')),
  summary TEXT,
  score INTEGER CHECK(score IS NULL OR (score >= 0 AND score <= 100)),
  reason TEXT,
  error TEXT,
  tokens_in INTEGER NOT NULL CHECK(tokens_in >= 0),
  tokens_out INTEGER NOT NULL CHECK(tokens_out >= 0),
  completed_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, article_id)
) STRICT;
CREATE TABLE IF NOT EXISTS content_enrichment_queue (
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('New', 'Reprocess')),
  status TEXT NOT NULL CHECK(status IN ('Queued', 'Processing', 'Succeeded', 'Failed')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
  lease_token TEXT,
  lease_expires_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  PRIMARY KEY(owner_id, article_id)
) STRICT;
CREATE INDEX IF NOT EXISTS content_enrichment_queue_claim
  ON content_enrichment_queue(owner_id, status, priority, published_at, created_at);
CREATE TABLE IF NOT EXISTS content_enrichment_daily_progress (
  local_date TEXT PRIMARY KEY,
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK(processed_count >= 0)
) STRICT;
`

const TargetRowSchema = Schema.Struct({
  articleId: Schema.String,
  title: Schema.String,
  markdownKey: Schema.String,
  leaseToken: Schema.String,
})
const QueueRowSchema = Schema.Struct({
  articleId: Schema.String,
  title: Schema.String,
  priority: Schema.Int,
  reason: Schema.String,
  status: Schema.String,
  attempt: Schema.Int,
  error: Schema.NullOr(Schema.String),
  publishedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
})
const CountRowSchema = Schema.Struct({ count: Schema.Int })
const OwnerRowSchema = Schema.Struct({ ownerId: Schema.String })

const failure = (
  operation: EnrichmentQueueError["operation"],
  reason: EnrichmentQueueError["reason"] = "Unavailable"
): EnrichmentQueueError =>
  deepFreeze({ _tag: "EnrichmentQueueFailed", operation, reason })

const parseCount = (
  row: unknown,
  operation: EnrichmentQueueError["operation"]
) =>
  parse(CountRowSchema)(row).pipe(
    Effect.map(({ count }) => count),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const ownerHasArchivedArticle = (
  database: SqlitePort,
  ownerId: string,
  articleId: string
): boolean =>
  database.get(
    `SELECT 1
       FROM feed_items i
       JOIN feed_subscriptions sub ON sub.feed_id = i.feed_id
      WHERE sub.owner_id = ? AND i.article_id = ?
        AND EXISTS (
          SELECT 1 FROM article_snapshots snapshot
           WHERE json_extract(snapshot.snapshot_json, '$.articleId') = i.article_id
        )
      LIMIT 1`,
    [ownerId, articleId]
  ) !== undefined

const queueSelect = `
SELECT queue.article_id AS articleId,
       item.title AS title,
       queue.priority AS priority,
       queue.reason AS reason,
       queue.status AS status,
       queue.attempt AS attempt,
       queue.error AS error,
       queue.published_at AS publishedAt,
       queue.created_at AS createdAt,
       queue.started_at AS startedAt,
       queue.completed_at AS completedAt
  FROM content_enrichment_queue queue
  JOIN feed_items item ON item.article_id = queue.article_id
 WHERE queue.owner_id = ?`

export const createSqliteEnrichmentQueue = (
  database: SqlitePort
): Effect.Effect<EnrichmentQueueRepository, EnrichmentQueueError> =>
  Effect.try({
    try: () => database.execute(schema),
    catch: () => failure("Reconcile"),
  }).pipe(
    Effect.map(() => {
      const reconcile: EnrichmentQueueRepository["reconcile"] = (now) =>
        Effect.try({
          try: () =>
            database.transaction(() => {
              database.run(
                `UPDATE content_enrichment_queue
                    SET status = 'Queued', lease_token = NULL,
                        lease_expires_at = NULL, started_at = NULL
                  WHERE status = 'Processing'
                    AND lease_expires_at IS NOT NULL
                    AND lease_expires_at < ?`,
                [now]
              )
              database.run(
                `INSERT OR IGNORE INTO content_enrichment_queue
                  (owner_id, article_id, priority, reason, status, attempt,
                   published_at, created_at)
                 SELECT sub.owner_id, item.article_id, ?, 'New', 'Queued', 0,
                        COALESCE(item.published_at, item.discovered_at), ?
                   FROM feed_items item
                   JOIN feed_subscriptions sub ON sub.feed_id = item.feed_id
                  WHERE EXISTS (
                          SELECT 1 FROM article_snapshots snapshot
                           WHERE json_extract(snapshot.snapshot_json, '$.articleId') = item.article_id
                        )
                    AND NOT EXISTS (
                          SELECT 1 FROM content_enrichment_results result
                           WHERE result.owner_id = sub.owner_id
                             AND result.article_id = item.article_id
                        )`,
                [NEW_PRIORITY, now]
              )
            }),
          catch: () => failure("Reconcile"),
        })

      const listOwners: EnrichmentQueueRepository["listOwners"] = () =>
        Effect.try({
          try: () =>
            database.all(
              `SELECT DISTINCT owner_id AS ownerId
                 FROM feed_subscriptions
                ORDER BY owner_id`
            ),
          catch: () => failure("ListOwners"),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              parse(OwnerRowSchema)(row).pipe(
                Effect.flatMap(({ ownerId }) => parse(OwnerIdSchema)(ownerId)),
                Effect.mapError(() => failure("ListOwners", "CorruptRecord"))
              )
            )
          ),
          Effect.map(deepFreeze)
        )

      const claim: EnrichmentQueueRepository["claim"] = (
        ownerId,
        limit,
        now,
        expiresAt,
        leaseToken
      ) => {
        if (limit <= 0) return Effect.succeed(deepFreeze([]))
        return Effect.try({
          try: () =>
            database.transaction(() => {
              const candidates = database.all(
                `SELECT queue.article_id AS articleId,
                        item.title AS title,
                        json_extract(snapshot.snapshot_json, '$.capture.markdown.key') AS markdownKey
                   FROM content_enrichment_queue queue
                   JOIN feed_items item ON item.article_id = queue.article_id
                   JOIN article_snapshots snapshot ON snapshot.rowid = (
                     SELECT latest.rowid FROM article_snapshots latest
                      WHERE json_extract(latest.snapshot_json, '$.articleId') = item.article_id
                      ORDER BY latest.captured_at DESC, latest.snapshot_id DESC
                      LIMIT 1
                   )
                  WHERE queue.owner_id = ?
                    AND queue.status IN ('Queued', 'Failed')
                    AND queue.attempt < ?
                  ORDER BY queue.priority ASC,
                           queue.published_at DESC,
                           queue.created_at ASC,
                           queue.article_id ASC
                  LIMIT ?`,
                [ownerId, ENRICHMENT_MAX_ATTEMPTS, limit]
              )
              const claimed: unknown[] = []
              for (const candidate of candidates) {
                const row = Schema.decodeUnknownSync(TargetRowSchema)({
                  ...(candidate as object),
                  leaseToken,
                })
                const updated = database.run(
                  `UPDATE content_enrichment_queue
                      SET status = 'Processing', lease_token = ?,
                          lease_expires_at = ?, started_at = ?, completed_at = NULL
                    WHERE owner_id = ? AND article_id = ?
                      AND status IN ('Queued', 'Failed')
                      AND attempt < ?`,
                  [
                    leaseToken,
                    expiresAt,
                    now,
                    ownerId,
                    row.articleId,
                    ENRICHMENT_MAX_ATTEMPTS,
                  ]
                )
                if (Number(updated.changes) === 1) claimed.push(row)
              }
              return claimed
            }),
          catch: () => failure("Claim"),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              parse(EnrichmentTargetSchema)(row).pipe(
                Effect.mapError(() => failure("Claim", "CorruptRecord"))
              )
            )
          ),
          Effect.map(deepFreeze)
        )
      }

      const completeSuccess: EnrichmentQueueRepository["completeSuccess"] = (
        ownerId,
        target,
        output,
        completedAt,
        localDate
      ) =>
        Effect.try({
          try: () =>
            database.transaction(() => {
              const completed = database.run(
                `UPDATE content_enrichment_queue
                    SET status = 'Succeeded', lease_token = NULL,
                        lease_expires_at = NULL, completed_at = ?, error = NULL
                  WHERE owner_id = ? AND article_id = ?
                    AND status = 'Processing' AND lease_token = ?`,
                [completedAt, ownerId, target.articleId, target.leaseToken]
              )
              if (Number(completed.changes) !== 1) {
                throw new Error("stale enrichment lease")
              }
              database.run(
                `INSERT INTO content_enrichment_results
                  (owner_id, article_id, status, summary, score, reason, error,
                   tokens_in, tokens_out, completed_at)
                 VALUES (?, ?, 'Succeeded', ?, ?, ?, NULL, ?, ?, ?)
                 ON CONFLICT(owner_id, article_id) DO UPDATE SET
                   status = excluded.status, summary = excluded.summary,
                   score = excluded.score, reason = excluded.reason,
                   error = excluded.error, tokens_in = excluded.tokens_in,
                   tokens_out = excluded.tokens_out,
                   completed_at = excluded.completed_at`,
                [
                  ownerId,
                  target.articleId,
                  output.summary,
                  output.score,
                  output.reason,
                  output.tokensIn,
                  output.tokensOut,
                  completedAt,
                ]
              )
              database.run(
                `DELETE FROM content_article_tags
                  WHERE owner_id = ? AND article_id = ? AND source = 'Ai'`,
                [ownerId, target.articleId]
              )
              for (const name of output.tags) {
                database.run(
                  `INSERT INTO content_article_tags
                    (owner_id, article_id, tag_id, source, confidence, created_at)
                   SELECT ?, ?, tag_id, 'Ai', 1, ?
                     FROM content_tags
                    WHERE owner_id = ? AND name = ?
                   ON CONFLICT(owner_id, article_id, tag_id) DO NOTHING`,
                  [ownerId, target.articleId, completedAt, ownerId, name]
                )
              }
              for (const name of new Set(output.suggestedTags)) {
                const vocabulary = database.get(
                  "SELECT 1 FROM content_tags WHERE owner_id = ? AND name = ?",
                  [ownerId, name]
                )
                if (vocabulary !== undefined) continue
                database.run(
                  `INSERT INTO content_tag_suggestions
                    (owner_id, name, occurrences, last_seen_at)
                   VALUES (?, ?, 1, ?)
                   ON CONFLICT(owner_id, name) DO UPDATE SET
                     occurrences = occurrences + 1,
                     last_seen_at = excluded.last_seen_at`,
                  [ownerId, name, completedAt]
                )
              }
              database.run(
                `INSERT INTO content_enrichment_daily_progress(local_date, processed_count)
                 VALUES (?, 1)
                 ON CONFLICT(local_date) DO UPDATE SET
                   processed_count = processed_count + 1`,
                [localDate]
              )
            }),
          catch: () => failure("Complete"),
        })

      const completeFailure: EnrichmentQueueRepository["completeFailure"] = (
        ownerId,
        target,
        error,
        retryable,
        completedAt
      ) =>
        Effect.try({
          try: () =>
            database.transaction(() => {
              const result = database.run(
                `UPDATE content_enrichment_queue
                  SET status = 'Failed',
                      attempt = CASE WHEN ? = 1 THEN attempt + 1 ELSE ? END,
                      lease_token = NULL, lease_expires_at = NULL,
                      completed_at = ?, error = ?
                WHERE owner_id = ? AND article_id = ?
                  AND status = 'Processing' AND lease_token = ?`,
                [
                  retryable ? 1 : 0,
                  ENRICHMENT_MAX_ATTEMPTS,
                  completedAt,
                  error,
                  ownerId,
                  target.articleId,
                  target.leaseToken,
                ]
              )
              if (Number(result.changes) !== 1) {
                throw new Error("stale enrichment lease")
              }
              database.run(
                `INSERT INTO content_enrichment_results
                  (owner_id, article_id, status, summary, score, reason, error,
                   tokens_in, tokens_out, completed_at)
                 VALUES (?, ?, 'Failed', NULL, NULL, NULL, ?, 0, 0, ?)
                 ON CONFLICT(owner_id, article_id) DO UPDATE SET
                   status = excluded.status, summary = NULL, score = NULL,
                   reason = NULL, error = excluded.error,
                   tokens_in = 0, tokens_out = 0,
                   completed_at = excluded.completed_at`,
                [ownerId, target.articleId, error, completedAt]
              )
            }),
          catch: () => failure("Complete"),
        })

      const budgetUsed: EnrichmentQueueRepository["budgetUsed"] = (date) =>
        Effect.try({
          try: () =>
            database.get(
              `SELECT processed_count AS count
                 FROM content_enrichment_daily_progress
                WHERE local_date = ?`,
              [date]
            ) ?? { count: 0 },
          catch: () => failure("Budget"),
        }).pipe(Effect.flatMap((row) => parseCount(row, "Budget")))

      const decodeItems = (
        rows: readonly unknown[],
        operation: EnrichmentQueueError["operation"]
      ) =>
        Effect.forEach(rows, (row) =>
          parse(QueueRowSchema)(row).pipe(
            Effect.flatMap((value) => parse(EnrichmentQueueItemSchema)(value)),
            Effect.mapError(() => failure(operation, "CorruptRecord"))
          )
        ).pipe(Effect.map(deepFreeze))

      const status: EnrichmentQueueRepository["status"] = (
        ownerId,
        dailyLimit,
        date
      ) =>
        Effect.try({
          try: () => ({
            processing: database.all(
              `${queueSelect} AND queue.status = 'Processing'
               ORDER BY queue.started_at, queue.created_at LIMIT 50`,
              [ownerId]
            ),
            pending: database.all(
              `${queueSelect}
                 AND queue.status IN ('Queued', 'Failed')
                 AND queue.attempt < ?
               ORDER BY queue.priority, queue.published_at DESC,
                        queue.created_at LIMIT 50`,
              [ownerId, ENRICHMENT_MAX_ATTEMPTS]
            ),
            failed: database.all(
              `${queueSelect} AND queue.status = 'Failed' AND queue.attempt >= ?
               ORDER BY queue.completed_at DESC LIMIT 50`,
              [ownerId, ENRICHMENT_MAX_ATTEMPTS]
            ),
            recent: database.all(
              `${queueSelect} AND queue.completed_at IS NOT NULL
               ORDER BY queue.completed_at DESC LIMIT 20`,
              [ownerId]
            ),
            pendingCount: database.get(
              `SELECT COUNT(*) AS count FROM content_enrichment_queue
                WHERE owner_id = ?
                  AND status IN ('Queued', 'Processing', 'Failed')
                  AND attempt < ?`,
              [ownerId, ENRICHMENT_MAX_ATTEMPTS]
            ),
            failedCount: database.get(
              `SELECT COUNT(*) AS count FROM content_enrichment_queue
                WHERE owner_id = ? AND status = 'Failed' AND attempt >= ?`,
              [ownerId, ENRICHMENT_MAX_ATTEMPTS]
            ),
            reprocessableCount: database.get(
              `SELECT COUNT(*) AS count FROM content_enrichment_results result
                WHERE result.owner_id = ?`,
              [ownerId]
            ),
            daily: database.get(
              `SELECT processed_count AS count
                 FROM content_enrichment_daily_progress WHERE local_date = ?`,
              [date]
            ) ?? { count: 0 },
          }),
          catch: () => failure("Status"),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.all({
              processing: decodeItems(rows.processing, "Status"),
              pendingItems: decodeItems(rows.pending, "Status"),
              failedItems: decodeItems(rows.failed, "Status"),
              recent: decodeItems(rows.recent, "Status"),
              pendingCount: parseCount(rows.pendingCount, "Status"),
              failedCount: parseCount(rows.failedCount, "Status"),
              reprocessableCount: parseCount(rows.reprocessableCount, "Status"),
              used: parseCount(rows.daily, "Status"),
            })
          ),
          Effect.map((decoded): EnrichmentQueueStatus =>
            deepFreeze({
              processing: decoded.processing,
              pending: {
                count: decoded.pendingCount,
                items: decoded.pendingItems,
              },
              failed: {
                count: decoded.failedCount,
                items: decoded.failedItems,
              },
              recent: decoded.recent,
              daily: { used: decoded.used, limit: dailyLimit },
              reprocessable: { count: decoded.reprocessableCount },
            })
          )
        )

      const enqueueReprocess: EnrichmentQueueRepository["enqueueReprocess"] = (
        ownerId,
        queuedAt
      ) =>
        Effect.try({
          try: () =>
            Number(
              database.run(
                `INSERT INTO content_enrichment_queue
                  (owner_id, article_id, priority, reason, status, attempt,
                   published_at, created_at)
                 SELECT result.owner_id, result.article_id, ?, 'Reprocess',
                        'Queued', 0,
                        COALESCE(item.published_at, item.discovered_at), ?
                   FROM content_enrichment_results result
                   JOIN feed_items item ON item.article_id = result.article_id
                   JOIN feed_subscriptions sub
                     ON sub.feed_id = item.feed_id
                    AND sub.owner_id = result.owner_id
                  WHERE result.owner_id = ?
                    AND NOT EXISTS (
                      SELECT 1 FROM content_enrichment_queue active
                       WHERE active.owner_id = result.owner_id
                         AND active.article_id = result.article_id
                         AND active.status = 'Processing'
                    )
                 ON CONFLICT(owner_id, article_id) DO UPDATE SET
                   priority = excluded.priority, reason = excluded.reason,
                   status = excluded.status, attempt = 0,
                   lease_token = NULL, lease_expires_at = NULL,
                   started_at = NULL, completed_at = NULL, error = NULL,
                   created_at = excluded.created_at`,
                [REPROCESS_PRIORITY, queuedAt, ownerId]
              ).changes
            ),
          catch: () => failure("Enqueue"),
        })

      const enqueueOne: EnrichmentQueueRepository["enqueueOne"] = (
        ownerId,
        articleId,
        queuedAt
      ) =>
        Effect.try({
          try: (): EnqueueEnrichmentResult =>
            database.transaction(() => {
              if (!ownerHasArchivedArticle(database, ownerId, articleId)) {
                return deepFreeze({ _tag: "NotFound" })
              }
              const active = database.get(
                `SELECT status FROM content_enrichment_queue
                  WHERE owner_id = ? AND article_id = ?`,
                [ownerId, articleId]
              ) as { readonly status?: unknown } | undefined
              if (active?.status === "Processing") {
                return deepFreeze({ _tag: "Processing" })
              }
              database.run(
                `INSERT INTO content_enrichment_queue
                  (owner_id, article_id, priority, reason, status, attempt,
                   published_at, created_at)
                 SELECT ?, item.article_id, ?, 'Reprocess', 'Queued', 0,
                        COALESCE(item.published_at, item.discovered_at), ?
                   FROM feed_items item WHERE item.article_id = ?
                 ON CONFLICT(owner_id, article_id) DO UPDATE SET
                   priority = excluded.priority, reason = excluded.reason,
                   status = excluded.status, attempt = 0,
                   lease_token = NULL, lease_expires_at = NULL,
                   started_at = NULL, completed_at = NULL, error = NULL,
                   created_at = excluded.created_at`,
                [ownerId, REPROCESS_PRIORITY, queuedAt, articleId]
              )
              return deepFreeze({ _tag: "Enqueued" })
            }),
          catch: () => failure("Enqueue"),
        })

      const resetDaily: EnrichmentQueueRepository["resetDaily"] = (date) =>
        Effect.try({
          try: () => {
            database.run(
              "DELETE FROM content_enrichment_daily_progress WHERE local_date = ?",
              [date]
            )
          },
          catch: () => failure("Budget"),
        })

      return deepFreeze({
        reconcile,
        listOwners,
        claim,
        completeSuccess,
        completeFailure,
        budgetUsed,
        status,
        enqueueReprocess,
        enqueueOne,
        resetDaily,
      })
    })
  )
