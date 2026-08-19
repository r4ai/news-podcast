import { deepFreeze } from "@news-podcast/kernel"
import { and, eq, not, sql } from "drizzle-orm"
import { Effect } from "effect"

import {
  articleOwnerAccess,
  contentEnrichmentQueue,
  contentEnrichmentResults,
  feedItems,
} from "../../../../drizzle/schema.js"
import type {
  EnqueueEnrichmentResult,
  EnrichmentQueueRepository,
} from "../../../application/enrichment.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import {
  failure,
  ownerHasArchivedArticle,
  publishedOrDiscovered,
  REPROCESS_PRIORITY,
} from "./row.js"

/**
 * 利用者からの明示的な再処理要求。所有と実行中状態を確かめてから積む。
 */
type Enqueueing = Pick<
  EnrichmentQueueRepository,
  "enqueueReprocess" | "enqueueOne"
>

/** 積み直しは前回の実行痕跡を残さない。試行回数も誤りも持ち越さない。 */
const resetOnConflict = (queuedAt: string) => ({
  target: [contentEnrichmentQueue.ownerId, contentEnrichmentQueue.articleId],
  set: {
    priority: REPROCESS_PRIORITY,
    reason: "Reprocess" as const,
    status: "Queued" as const,
    attempt: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    startedAt: null,
    completedAt: null,
    error: null,
    createdAt: queuedAt,
  },
})

export const makeEnqueueing = (
  database: ContentKnowledgeDatabase
): Enqueueing => ({
  // 実行中のものは巻き込まず、結果が出ている記事だけをまとめて積み直す。
  enqueueReprocess: (ownerId, queuedAt) =>
    Effect.try({
      try: () => {
        const isProcessing = sql`EXISTS (
          SELECT 1 FROM content_enrichment_queue active
           WHERE active.owner_id = ${contentEnrichmentResults.ownerId}
             AND active.article_id = ${contentEnrichmentResults.articleId}
             AND active.status = 'Processing'
        )`

        return Number(
          database
            .insert(contentEnrichmentQueue)
            .select(
              database
                .select({
                  ownerId: contentEnrichmentResults.ownerId,
                  articleId: contentEnrichmentResults.articleId,
                  priority: sql`${REPROCESS_PRIORITY}`.as("priority"),
                  reason: sql`'Reprocess'`.as("reason"),
                  status: sql`'Queued'`.as("status"),
                  attempt: sql`0`.as("attempt"),
                  publishedAt: publishedOrDiscovered.as("published_at"),
                  createdAt: sql`${queuedAt}`.as("created_at"),
                })
                .from(contentEnrichmentResults)
                .innerJoin(
                  feedItems,
                  eq(feedItems.articleId, contentEnrichmentResults.articleId)
                )
                .innerJoin(
                  articleOwnerAccess,
                  and(
                    eq(articleOwnerAccess.articleId, feedItems.articleId),
                    eq(
                      articleOwnerAccess.ownerId,
                      contentEnrichmentResults.ownerId
                    )
                  )
                )
                .where(
                  and(
                    eq(contentEnrichmentResults.ownerId, ownerId),
                    not(isProcessing)
                  )
                )
            )
            .onConflictDoUpdate(resetOnConflict(queuedAt))
            .run().changes
        )
      },
      catch: () => failure("Enqueue"),
    }),

  enqueueOne: (ownerId, articleId, queuedAt) =>
    Effect.try({
      try: (): EnqueueEnrichmentResult =>
        database.transaction((tx) => {
          if (!ownerHasArchivedArticle(tx, ownerId, articleId)) {
            return deepFreeze({ _tag: "NotFound" })
          }

          const active = tx
            .select({ status: contentEnrichmentQueue.status })
            .from(contentEnrichmentQueue)
            .where(
              and(
                eq(contentEnrichmentQueue.ownerId, ownerId),
                eq(contentEnrichmentQueue.articleId, articleId)
              )
            )
            .get()
          if (active?.status === "Processing") {
            return deepFreeze({ _tag: "Processing" })
          }

          tx.insert(contentEnrichmentQueue)
            .select(
              tx
                .select({
                  ownerId: sql`${ownerId}`.as("owner_id"),
                  articleId: feedItems.articleId,
                  priority: sql`${REPROCESS_PRIORITY}`.as("priority"),
                  reason: sql`'Reprocess'`.as("reason"),
                  status: sql`'Queued'`.as("status"),
                  attempt: sql`0`.as("attempt"),
                  publishedAt: publishedOrDiscovered.as("published_at"),
                  createdAt: sql`${queuedAt}`.as("created_at"),
                })
                .from(feedItems)
                .where(eq(feedItems.articleId, articleId))
            )
            .onConflictDoUpdate(resetOnConflict(queuedAt))
            .run()

          return deepFreeze({ _tag: "Enqueued" })
        }),
      catch: () => failure("Enqueue"),
    }),
})
