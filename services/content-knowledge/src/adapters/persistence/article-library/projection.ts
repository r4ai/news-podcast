import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleOwnerAccess,
  articleOwnerStates,
  articleSnapshots,
  feedItems,
} from "../../../../drizzle/schema.js"
import type { ArticleLibraryError } from "../../../application/article-library.js"
import { ArticleViewSchema } from "../../../domain/article-library.js"
import { latestSnapshotOfArticle } from "../latest-article-snapshot.js"

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
  feedUrl: Schema.String,
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

export const articleProjection = {
  articleId: feedItems.articleId,
  feedId: feedItems.feedId,
  // アーカイブ済みの記事は、本文と同じsnapshotのmetadataを表示する。
  title: sql<string>`COALESCE(
    json_extract(${articleSnapshots.snapshotJson}, '$.title'),
    ${feedItems.title}
  )`.as("title"),
  sourceUrl: sql<string>`COALESCE(
    json_extract(${articleSnapshots.snapshotJson}, '$.sourceUrl'),
    ${feedItems.sourceUrl}
  )`.as("sourceUrl"),
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
 * 恒久アクセス権と、最新スナップショットの結合条件。
 * 結合の連鎖自体は各呼び出し側に書くが、述語はここに集約して
 * 「所有」の定義がぶれないようにする。
 */
export const accessibleByOwner = eq(
  articleOwnerAccess.articleId,
  feedItems.articleId
)

export const ownerStateOfArticle = and(
  eq(articleOwnerStates.ownerId, articleOwnerAccess.ownerId),
  eq(articleOwnerStates.articleId, feedItems.articleId)
)

export { latestSnapshotOfArticle }

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
