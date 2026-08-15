import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, eq, exists, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleSnapshots,
  feedItems,
  feedSubscriptions,
} from "../../../../drizzle/schema.js"
import type { EnrichmentQueueError } from "../../../application/enrichment.js"
import type { QueryRunner } from "../../../infrastructure/unsafe/drizzle/open.js"

export const NEW_PRIORITY = 0
export const REPROCESS_PRIORITY = 100

export const TargetRowSchema = Schema.Struct({
  articleId: Schema.String,
  title: Schema.String,
  markdownKey: Schema.String,
  leaseToken: Schema.String,
})
export const QueueRowSchema = Schema.Struct({
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
export const CountRowSchema = Schema.Struct({ count: Schema.Int })
export const OwnerRowSchema = Schema.Struct({ ownerId: Schema.String })

export const failure = (
  operation: EnrichmentQueueError["operation"],
  reason: EnrichmentQueueError["reason"] = "Unavailable"
): EnrichmentQueueError =>
  deepFreeze({ _tag: "EnrichmentQueueFailed", operation, reason })

export const parseCount = (
  row: unknown,
  operation: EnrichmentQueueError["operation"]
) =>
  parse(CountRowSchema)(row).pipe(
    Effect.map(({ count }) => count),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

/** 記事の並び順の基準。公開日時が無ければ発見日時で代替する。 */
export const publishedOrDiscovered = sql`COALESCE(${feedItems.publishedAt}, ${feedItems.discoveredAt})`

/** アーカイブ済みであること。article_id が実カラムになり索引で解ける。 */
export const hasSnapshot = (runner: QueryRunner) =>
  exists(
    runner
      .select({ one: sql`1` })
      .from(articleSnapshots)
      .where(eq(articleSnapshots.articleId, feedItems.articleId))
  )

/** 購読を通じて所有し、かつアーカイブ済みの記事だけが対象になる。 */
export const ownerHasArchivedArticle = (
  runner: QueryRunner,
  ownerId: string,
  articleId: string
): boolean =>
  runner
    .select({ articleId: feedItems.articleId })
    .from(feedItems)
    .innerJoin(
      feedSubscriptions,
      eq(feedSubscriptions.feedId, feedItems.feedId)
    )
    .where(
      and(
        eq(feedSubscriptions.ownerId, ownerId),
        eq(feedItems.articleId, articleId),
        hasSnapshot(runner)
      )
    )
    .limit(1)
    .get() !== undefined
