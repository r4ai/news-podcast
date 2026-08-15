import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  sql,
  type SQL,
} from "drizzle-orm"
import { Effect } from "effect"

import {
  contentEnrichmentDailyProgress,
  contentEnrichmentQueue,
  contentEnrichmentResults,
  feedItems,
} from "../../../../drizzle/schema.js"
import type {
  EnrichmentQueueError,
  EnrichmentQueueRepository,
  EnrichmentQueueStatus,
} from "../../../application/enrichment.js"
import {
  ENRICHMENT_MAX_ATTEMPTS,
  EnrichmentQueueItemSchema,
} from "../../../domain/enrichment.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { failure, parseCount, QueueRowSchema } from "./row.js"

/**
 * キューの見える化：滞留・失敗・直近の履歴と、日次消費量の読み書き。
 */
type Reporting = Pick<
  EnrichmentQueueRepository,
  "budgetUsed" | "status" | "resetDaily"
>

const queueProjection = {
  articleId: contentEnrichmentQueue.articleId,
  title: feedItems.title,
  priority: contentEnrichmentQueue.priority,
  reason: contentEnrichmentQueue.reason,
  status: contentEnrichmentQueue.status,
  attempt: contentEnrichmentQueue.attempt,
  error: contentEnrichmentQueue.error,
  publishedAt: contentEnrichmentQueue.publishedAt,
  createdAt: contentEnrichmentQueue.createdAt,
  startedAt: contentEnrichmentQueue.startedAt,
  completedAt: contentEnrichmentQueue.completedAt,
}

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

export const makeReporting = (
  database: ContentKnowledgeDatabase
): Reporting => {
  const queueItems = (ownerId: string, extra: SQL) =>
    database
      .select(queueProjection)
      .from(contentEnrichmentQueue)
      .innerJoin(
        feedItems,
        eq(feedItems.articleId, contentEnrichmentQueue.articleId)
      )
      .where(and(eq(contentEnrichmentQueue.ownerId, ownerId), extra))

  const countQueue = (ownerId: string, extra: SQL) =>
    database
      .select({ count: sql<number>`COUNT(*)`.as("count") })
      .from(contentEnrichmentQueue)
      .where(and(eq(contentEnrichmentQueue.ownerId, ownerId), extra))
      .get()

  const dailyProgress = (date: string) =>
    database
      .select({ count: contentEnrichmentDailyProgress.processedCount })
      .from(contentEnrichmentDailyProgress)
      .where(eq(contentEnrichmentDailyProgress.localDate, date))
      .get() ?? { count: 0 }

  return {
    budgetUsed: (date) =>
      Effect.try({
        try: () => dailyProgress(date),
        catch: () => failure("Budget"),
      }).pipe(Effect.flatMap((row) => parseCount(row, "Budget"))),

    status: (ownerId, dailyLimit, date) =>
      Effect.try({
        try: () => ({
          processing: queueItems(
            ownerId,
            eq(contentEnrichmentQueue.status, "Processing")
          )
            .orderBy(
              asc(contentEnrichmentQueue.startedAt),
              asc(contentEnrichmentQueue.createdAt)
            )
            .limit(50)
            .all(),
          // 上限に達していない失敗は、まだ再試行の余地があるので滞留として扱う。
          pending: queueItems(
            ownerId,
            and(
              inArray(contentEnrichmentQueue.status, ["Queued", "Failed"]),
              lt(contentEnrichmentQueue.attempt, ENRICHMENT_MAX_ATTEMPTS)
            ) as SQL
          )
            .orderBy(
              asc(contentEnrichmentQueue.priority),
              desc(contentEnrichmentQueue.publishedAt),
              asc(contentEnrichmentQueue.createdAt)
            )
            .limit(50)
            .all(),
          failed: queueItems(
            ownerId,
            and(
              eq(contentEnrichmentQueue.status, "Failed"),
              gte(contentEnrichmentQueue.attempt, ENRICHMENT_MAX_ATTEMPTS)
            ) as SQL
          )
            .orderBy(desc(contentEnrichmentQueue.completedAt))
            .limit(50)
            .all(),
          recent: queueItems(
            ownerId,
            isNotNull(contentEnrichmentQueue.completedAt)
          )
            .orderBy(desc(contentEnrichmentQueue.completedAt))
            .limit(20)
            .all(),
          pendingCount: countQueue(
            ownerId,
            and(
              inArray(contentEnrichmentQueue.status, [
                "Queued",
                "Processing",
                "Failed",
              ]),
              lt(contentEnrichmentQueue.attempt, ENRICHMENT_MAX_ATTEMPTS)
            ) as SQL
          ),
          failedCount: countQueue(
            ownerId,
            and(
              eq(contentEnrichmentQueue.status, "Failed"),
              gte(contentEnrichmentQueue.attempt, ENRICHMENT_MAX_ATTEMPTS)
            ) as SQL
          ),
          reprocessableCount: database
            .select({ count: sql<number>`COUNT(*)`.as("count") })
            .from(contentEnrichmentResults)
            .where(eq(contentEnrichmentResults.ownerId, ownerId))
            .get(),
          daily: dailyProgress(date),
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
            failed: { count: decoded.failedCount, items: decoded.failedItems },
            recent: decoded.recent,
            daily: { used: decoded.used, limit: dailyLimit },
            reprocessable: { count: decoded.reprocessableCount },
          })
        )
      ),

    resetDaily: (date) =>
      Effect.try({
        try: () =>
          database
            .delete(contentEnrichmentDailyProgress)
            .where(eq(contentEnrichmentDailyProgress.localDate, date))
            .run(),
        catch: () => failure("Budget"),
      }).pipe(Effect.asVoid),
  }
}
