import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type {
  ArticleLibraryError,
  ArticleListQuery,
} from "../../application/article-library.js"
import {
  ArticleViewSchema,
  decodeArticleCursor,
} from "../../domain/article-library.js"
import { articleOwnerStatesSchema } from "../sqlite-article-state-schema.js"

/**
 * 記事一覧の読み出しに共通する土台。
 * 絞り込み・並び・カーソル比較で同じ式を使い、ページ間で順序がぶれないようにする。
 */

export const articleLibrarySchema = `
${articleOwnerStatesSchema}
`

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

// 購読を通じた所有と、最新スナップショットの結合。読み出しは常にここを通る。
export const from = `
  FROM feed_items i
  JOIN feed_subscriptions sub ON sub.feed_id = i.feed_id
  LEFT JOIN article_owner_states state
    ON state.owner_id = sub.owner_id AND state.article_id = i.article_id
  LEFT JOIN article_snapshots snapshot ON snapshot.rowid = (
    SELECT candidate.rowid
      FROM article_snapshots candidate
     WHERE json_extract(candidate.snapshot_json, '$.articleId') = i.article_id
     ORDER BY candidate.captured_at DESC, candidate.snapshot_id DESC
     LIMIT 1
  )`

export const select = `
SELECT i.article_id AS articleId,
       i.feed_id AS feedId,
       i.title AS title,
       i.source_url AS sourceUrl,
       i.published_at AS publishedAt,
       i.discovered_at AS discoveredAt,
       json_extract(snapshot.snapshot_json, '$.snapshotId') AS snapshotId,
       json_extract(snapshot.snapshot_json, '$.capture.markdown.key') AS markdownKey,
       COALESCE(state.read, 0) AS read,
       COALESCE(state.saved, 0) AS saved,
       COALESCE(state.read_later, 0) AS readLater,
       COALESCE(state.hidden, 0) AS hidden,
       state.hidden_at AS hiddenAt
${from}`

const escapeLike = (input: string): string =>
  input.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")

export const queryFilter = (
  query: Pick<ArticleListQuery, "state" | "includeHidden" | "feedIds" | "q">
) => {
  const sql: string[] = []
  const parameters: string[] = []
  if (!query.includeHidden) sql.push("COALESCE(state.hidden, 0) = 0")
  if (query.state === "Unread") sql.push("COALESCE(state.read, 0) = 0")
  if (query.state === "Saved") sql.push("COALESCE(state.saved, 0) = 1")
  if (query.state === "Later") sql.push("COALESCE(state.read_later, 0) = 1")
  if (query.feedIds.length > 0) {
    sql.push(`i.feed_id IN (${query.feedIds.map(() => "?").join(", ")})`)
    parameters.push(...query.feedIds)
  }
  if (query.q !== undefined) {
    sql.push("(i.title LIKE ? ESCAPE '\\' OR i.source_url LIKE ? ESCAPE '\\')")
    const pattern = `%${escapeLike(query.q)}%`
    parameters.push(pattern, pattern)
  }
  return deepFreeze({ sql, parameters })
}

/** ORDER BYとカーソル比較で同じ式を使い、並びと継続位置がずれないようにする。 */
export const sortKeyExpression = "COALESCE(i.published_at, i.discovered_at)"

/**
 * `(sortKey, articleId)`の辞書式順序で「カーソルより後」を表すkeyset条件。
 * OFFSETと違い、ページ跨ぎで行が挿入・削除されても重複・欠落しない。
 */
export const keysetFilter = (
  query: Pick<ArticleListQuery, "cursor" | "order">
) => {
  const position =
    query.cursor === undefined ? undefined : decodeArticleCursor(query.cursor)
  if (position === undefined) return deepFreeze({ sql: [], parameters: [] })
  const comparison = query.order === "Newest" ? "<" : ">"
  return deepFreeze({
    sql: [
      `(${sortKeyExpression} ${comparison} ? OR (${sortKeyExpression} = ? AND i.article_id ${comparison} ?))`,
    ],
    parameters: [position.sortKey, position.sortKey, position.articleId],
  })
}

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
