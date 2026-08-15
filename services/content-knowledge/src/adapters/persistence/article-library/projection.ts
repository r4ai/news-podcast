import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleOwnerStates,
  articleSnapshots,
  feedItems,
  feedSubscriptions,
} from "../../../../drizzle/schema.js"
import type { ArticleLibraryError } from "../../../application/article-library.js"
import { ArticleViewSchema } from "../../../domain/article-library.js"

const ArticleRowSchema = Schema.Struct({
  articleId: Schema.String,
  feedId: Schema.String,
  title: Schema.String,
  sourceUrl: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  discoveredAt: Schema.String,
  snapshotId: Schema.NullOr(Schema.String),
  markdownKey: Schema.NullOr(Schema.String),
  read: Schema.Int,
  saved: Schema.Int,
  readLater: Schema.Int,
  hidden: Schema.Int,
  hiddenAt: Schema.NullOr(Schema.String),
})
export const parseArticleRow = parse(ArticleRowSchema)

export const CountRowSchema = Schema.Struct({
  allCount: Schema.Int,
  unreadCount: Schema.Int,
  savedCount: Schema.Int,
  laterCount: Schema.Int,
})
export const FeedCountRowSchema = Schema.Struct({
  feedId: Schema.String,
  count: Schema.Int,
})

export const failure = (
  operation: ArticleLibraryError["operation"],
  reason: ArticleLibraryError["reason"] = "Unavailable"
): ArticleLibraryError =>
  deepFreeze({ _tag: "ArticleLibraryFailed", operation, reason })

/** 状態行が無い記事は「まだ何もしていない」として0を既定にする。 */
export const stateFlag = (column: typeof articleOwnerStates.read) =>
  sql<number>`COALESCE(${column}, 0)`

/** ORDER BYとカーソル比較で同じ式を使い、並びと継続位置がずれないようにする。 */
export const sortKeyExpression = sql`COALESCE(${feedItems.publishedAt}, ${feedItems.discoveredAt})`

/**
 * 記事ごとの最新スナップショット。article_id が実カラムになったため
 * article_snapshots_latest インデックスで解決できる。
 */
const latestSnapshotId = sql`(
  SELECT candidate.snapshot_id
    FROM article_snapshots AS candidate
   WHERE candidate.article_id = ${feedItems.articleId}
   ORDER BY candidate.captured_at DESC, candidate.snapshot_id DESC
   LIMIT 1
)`

export const articleProjection = {
  articleId: feedItems.articleId,
  feedId: feedItems.feedId,
  title: feedItems.title,
  sourceUrl: feedItems.sourceUrl,
  publishedAt: feedItems.publishedAt,
  discoveredAt: feedItems.discoveredAt,
  snapshotId: articleSnapshots.snapshotId,
  // 本文キーだけはスナップショットJSON内にしか無い。
  markdownKey: sql<
    string | null
  >`json_extract(${articleSnapshots.snapshotJson}, '$.capture.markdown.key')`.as(
    "markdownKey"
  ),
  read: stateFlag(articleOwnerStates.read).as("read"),
  saved: stateFlag(articleOwnerStates.saved).as("saved"),
  readLater: stateFlag(articleOwnerStates.readLater).as("readLater"),
  hidden: stateFlag(articleOwnerStates.hidden).as("hidden"),
  hiddenAt: articleOwnerStates.hiddenAt,
}

/**
 * 購読を通じた所有と、最新スナップショットの結合条件。
 * 結合の連鎖自体は各呼び出し側に書くが、述語はここに集約して
 * 「所有」の定義がぶれないようにする。
 */
export const ownedBySubscription = eq(
  feedSubscriptions.feedId,
  feedItems.feedId
)

export const ownerStateOfArticle = and(
  eq(articleOwnerStates.ownerId, feedSubscriptions.ownerId),
  eq(articleOwnerStates.articleId, feedItems.articleId)
)

export const latestSnapshotOfArticle = eq(
  articleSnapshots.snapshotId,
  latestSnapshotId
)

export const decodeArticle = (
  row: unknown,
  operation: ArticleLibraryError["operation"]
) =>
  parseArticleRow(row).pipe(
    Effect.flatMap((parsed) =>
      parse(ArticleViewSchema)({
        articleId: parsed.articleId,
        feedId: parsed.feedId,
        title: parsed.title,
        sourceUrl: parsed.sourceUrl,
        publishedAt: parsed.publishedAt,
        discoveredAt: parsed.discoveredAt,
        archiveStatus: parsed.snapshotId === null ? "Pending" : "Succeeded",
        snapshotId: parsed.snapshotId,
        state: {
          read: parsed.read === 1,
          saved: parsed.saved === 1,
          readLater: parsed.readLater === 1,
          hidden: parsed.hidden === 1,
          hiddenAt: parsed.hiddenAt,
        },
      })
    ),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )
