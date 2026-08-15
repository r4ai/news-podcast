import { deepFreeze, parse } from "@news-podcast/kernel"
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  not,
  sql,
} from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleSnapshots,
  contentEnrichmentQueue,
  feedItems,
  feedSubscriptions,
} from "../../../../drizzle/schema.js"
import type { EnrichmentQueueRepository } from "../../../application/enrichment.js"
import {
  ENRICHMENT_MAX_ATTEMPTS,
  EnrichmentTargetSchema,
} from "../../../domain/enrichment.js"
import { OwnerIdSchema } from "../../../domain/subscription.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import {
  failure,
  hasSnapshot,
  NEW_PRIORITY,
  OwnerRowSchema,
  publishedOrDiscovered,
  TargetRowSchema,
} from "./row.js"

/**
 * キューの入口側：期限切れリースの回収、未処理記事の投入、そして排他的な取得。
 */
type Claiming = Pick<
  EnrichmentQueueRepository,
  "reconcile" | "listOwners" | "claim"
>

const decodeTargetRow = Schema.decodeUnknownSync(TargetRowSchema)

export const makeClaiming = (database: ContentKnowledgeDatabase): Claiming => ({
  // 期限切れのリースをQueuedへ戻したうえで、未処理の購読記事を取りこぼさず補充する。
  reconcile: (now) =>
    Effect.try({
      try: () =>
        database.transaction((tx) => {
          tx.update(contentEnrichmentQueue)
            .set({
              status: "Queued",
              leaseToken: null,
              leaseExpiresAt: null,
              startedAt: null,
            })
            .where(
              and(
                eq(contentEnrichmentQueue.status, "Processing"),
                isNotNull(contentEnrichmentQueue.leaseExpiresAt),
                lt(contentEnrichmentQueue.leaseExpiresAt, now)
              )
            )
            .run()

          // 既に結果が出ている記事は積み直さない。
          const alreadyResolved = sql`EXISTS (
            SELECT 1 FROM content_enrichment_results result
             WHERE result.owner_id = ${feedSubscriptions.ownerId}
               AND result.article_id = ${feedItems.articleId}
          )`

          tx.insert(contentEnrichmentQueue)
            .select(
              tx
                .select({
                  ownerId: feedSubscriptions.ownerId,
                  articleId: feedItems.articleId,
                  priority: sql`${NEW_PRIORITY}`.as("priority"),
                  reason: sql`'New'`.as("reason"),
                  status: sql`'Queued'`.as("status"),
                  attempt: sql`0`.as("attempt"),
                  publishedAt: publishedOrDiscovered.as("published_at"),
                  createdAt: sql`${now}`.as("created_at"),
                })
                .from(feedItems)
                .innerJoin(
                  feedSubscriptions,
                  eq(feedSubscriptions.feedId, feedItems.feedId)
                )
                .where(and(hasSnapshot(tx), not(alreadyResolved)))
            )
            .onConflictDoNothing({
              target: [
                contentEnrichmentQueue.ownerId,
                contentEnrichmentQueue.articleId,
              ],
            })
            .run()
        }),
      catch: () => failure("Reconcile"),
    }).pipe(Effect.asVoid),

  listOwners: () =>
    Effect.try({
      try: () =>
        database
          .selectDistinct({ ownerId: feedSubscriptions.ownerId })
          .from(feedSubscriptions)
          .orderBy(asc(feedSubscriptions.ownerId))
          .all(),
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
    ),

  // 候補を1件ずつ条件付き更新で押さえ、実際に取れたものだけを返す。
  claim: (ownerId, limit, now, expiresAt, leaseToken) => {
    if (limit <= 0) return Effect.succeed(deepFreeze([]))

    return Effect.try({
      try: () =>
        database.transaction((tx) => {
          const latestSnapshotId = sql`(
            SELECT latest.snapshot_id FROM article_snapshots latest
             WHERE latest.article_id = ${feedItems.articleId}
             ORDER BY latest.captured_at DESC, latest.snapshot_id DESC
             LIMIT 1
          )`

          const candidates = tx
            .select({
              articleId: contentEnrichmentQueue.articleId,
              title: feedItems.title,
              markdownKey:
                sql<string>`json_extract(${articleSnapshots.snapshotJson}, '$.capture.markdown.key')`.as(
                  "markdownKey"
                ),
            })
            .from(contentEnrichmentQueue)
            .innerJoin(
              feedItems,
              eq(feedItems.articleId, contentEnrichmentQueue.articleId)
            )
            .innerJoin(
              articleSnapshots,
              eq(articleSnapshots.snapshotId, latestSnapshotId)
            )
            .where(
              and(
                eq(contentEnrichmentQueue.ownerId, ownerId),
                inArray(contentEnrichmentQueue.status, ["Queued", "Failed"]),
                lt(contentEnrichmentQueue.attempt, ENRICHMENT_MAX_ATTEMPTS)
              )
            )
            .orderBy(
              asc(contentEnrichmentQueue.priority),
              desc(contentEnrichmentQueue.publishedAt),
              asc(contentEnrichmentQueue.createdAt),
              asc(contentEnrichmentQueue.articleId)
            )
            .limit(limit)
            .all()

          const claimed: unknown[] = []
          for (const candidate of candidates) {
            const row = decodeTargetRow({ ...candidate, leaseToken })
            const updated = tx
              .update(contentEnrichmentQueue)
              .set({
                status: "Processing",
                leaseToken,
                leaseExpiresAt: expiresAt,
                startedAt: now,
                completedAt: null,
              })
              .where(
                and(
                  eq(contentEnrichmentQueue.ownerId, ownerId),
                  eq(contentEnrichmentQueue.articleId, row.articleId),
                  inArray(contentEnrichmentQueue.status, ["Queued", "Failed"]),
                  lt(contentEnrichmentQueue.attempt, ENRICHMENT_MAX_ATTEMPTS)
                )
              )
              .run()
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
  },
})
