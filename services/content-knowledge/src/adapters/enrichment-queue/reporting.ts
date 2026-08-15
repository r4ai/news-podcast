import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  EnrichmentQueueError,
  EnrichmentQueueRepository,
  EnrichmentQueueStatus,
} from "../../application/enrichment.js"
import {
  ENRICHMENT_MAX_ATTEMPTS,
  EnrichmentQueueItemSchema,
} from "../../domain/enrichment.js"
import type { SqlitePort } from "../sqlite-port.js"
import { QueueRowSchema, failure, parseCount } from "./schema.js"

/**
 * キューの見える化：滞留・失敗・直近の履歴と、日次消費量の読み書き。
 */

type Reporting = Pick<
  EnrichmentQueueRepository,
  "budgetUsed" | "status" | "resetDaily"
>

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

export const makeReporting = (database: SqlitePort): Reporting => ({
  budgetUsed: (date) =>
    Effect.try({
      try: () =>
        database.get(
          `SELECT processed_count AS count
             FROM content_enrichment_daily_progress
            WHERE local_date = ?`,
          [date]
        ) ?? { count: 0 },
      catch: () => failure("Budget"),
    }).pipe(Effect.flatMap((row) => parseCount(row, "Budget"))),

  status: (ownerId, dailyLimit, date) =>
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
          pending: { count: decoded.pendingCount, items: decoded.pendingItems },
          failed: { count: decoded.failedCount, items: decoded.failedItems },
          recent: decoded.recent,
          daily: { used: decoded.used, limit: dailyLimit },
          reprocessable: { count: decoded.reprocessableCount },
        })
      )
    ),

  resetDaily: (date) =>
    Effect.try({
      try: () => {
        database.run(
          "DELETE FROM content_enrichment_daily_progress WHERE local_date = ?",
          [date]
        )
      },
      catch: () => failure("Budget"),
    }),
})
