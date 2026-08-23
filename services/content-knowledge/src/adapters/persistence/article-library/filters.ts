import { and, eq, gt, inArray, lt, or, sql, type SQL } from "drizzle-orm"

import {
  articleOwnerAccess,
  articleOwnerStates,
  articleSnapshots,
  contentArticleTags,
  contentTags,
  feedItems,
} from "../../../../drizzle/schema.js"
import type { ArticleListQuery } from "../../../application/article-library.js"
import { decodeArticleCursor } from "../../../domain/article-library.js"
import { escapeLikePattern } from "../like.js"
import { sortKeyExpression, stateFlag } from "./projection.js"

export type LibraryFilter = Pick<
  ArticleListQuery,
  "state" | "includeHidden" | "feedIds" | "q"
>

/** User input is always one literal phrase, never executable FTS5 syntax. */
export const articleBodySearchPredicate = (query: string): SQL => {
  const characters = [...query]
  if (characters.length <= 2) {
    return sql`EXISTS (
      SELECT 1
      FROM article_search_short_grams
      WHERE article_search_short_grams.snapshot_id = ${articleSnapshots.snapshotId}
        AND article_search_short_grams.gram = ${query}
    )`
  }
  const literalPhrase = `"${query.replaceAll('"', '""')}"`
  return sql`EXISTS (
    SELECT 1
    FROM article_search_fts
    WHERE article_search_fts.snapshot_id = ${articleSnapshots.snapshotId}
      AND article_search_fts MATCH ${literalPhrase}
  )`
}

/**
 * 一覧の絞り込み条件。状態はCOALESCEを通し、状態行が無い記事も
 * 「未読」として正しく数えられるようにする。
 */
export const queryFilters = (query: LibraryFilter): readonly SQL[] => {
  const filters: SQL[] = []

  if (!query.includeHidden) {
    filters.push(eq(stateFlag(articleOwnerStates.hidden), 0))
  }
  if (query.state === "Unread") {
    filters.push(eq(stateFlag(articleOwnerStates.read), 0))
  }
  if (query.state === "Saved") {
    filters.push(eq(stateFlag(articleOwnerStates.saved), 1))
  }
  if (query.state === "Later") {
    filters.push(eq(stateFlag(articleOwnerStates.readLater), 1))
  }
  if (query.feedIds.length > 0) {
    filters.push(inArray(feedItems.feedId, [...query.feedIds]))
  }
  if (query.q !== undefined) {
    const pattern = `%${escapeLikePattern(query.q)}%`
    filters.push(
      or(
        sql`COALESCE(
          json_extract(${articleSnapshots.snapshotJson}, '$.title'),
          ${feedItems.title}
        ) LIKE ${pattern} ESCAPE '\\'`,
        sql`COALESCE(
          json_extract(${articleSnapshots.snapshotJson}, '$.sourceUrl'),
          ${feedItems.sourceUrl}
        ) LIKE ${pattern} ESCAPE '\\'`,
        articleBodySearchPredicate(query.q),
        sql`EXISTS (
          SELECT 1
          FROM ${contentArticleTags}
          INNER JOIN ${contentTags}
            ON ${contentTags.ownerId} = ${contentArticleTags.ownerId}
           AND ${contentTags.tagId} = ${contentArticleTags.tagId}
          WHERE ${contentArticleTags.ownerId} = ${articleOwnerAccess.ownerId}
            AND ${contentArticleTags.articleId} = ${feedItems.articleId}
            AND ${contentTags.name} LIKE ${pattern} ESCAPE '\\'
        )`
      ) as SQL
    )
  }

  return filters
}

/**
 * `(sortKey, articleId)`の辞書式順序で「カーソルより後」を表すkeyset条件。
 * OFFSETと違い、ページ跨ぎで行が挿入・削除されても重複・欠落しない。
 */
export const keysetFilters = (
  query: Pick<ArticleListQuery, "cursor" | "order">
): readonly SQL[] => {
  const position =
    query.cursor === undefined ? undefined : decodeArticleCursor(query.cursor)
  if (position === undefined) return []

  const beyond = query.order === "Newest" ? lt : gt
  return [
    or(
      beyond(sortKeyExpression, position.sortKey),
      and(
        eq(sortKeyExpression, position.sortKey),
        beyond(feedItems.articleId, position.articleId)
      )
    ) as SQL,
  ]
}
