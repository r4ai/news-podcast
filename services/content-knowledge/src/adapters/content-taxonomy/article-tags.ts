import { deepFreeze } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type {
  ContentTaxonomyError,
  ContentTaxonomyRepository,
  SetArticleTagsResult,
} from "../../application/content-taxonomy.js"
import type { SqlitePort } from "../sqlite-port.js"
import {
  IdRowSchema,
  decodeArticleTag,
  failure,
  ownerHasArticle,
} from "./schema.js"

/**
 * 記事へのタグ付け。手動とAIは同じ表に載るが、互いを上書きしない。
 */

type ArticleTags = Pick<
  ContentTaxonomyRepository,
  "listArticleTags" | "setManualArticleTags" | "applyAiTags"
>

const REPLACE_BY_SOURCE = `DELETE FROM content_article_tags
    WHERE owner_id = ? AND article_id = ? AND source = ?`

export const makeArticleTags = (database: SqlitePort): ArticleTags => {
  const listArticleTags: ContentTaxonomyRepository["listArticleTags"] = (
    ownerId,
    articleId
  ) =>
    Effect.try({
      try: () =>
        database.all(
          `SELECT at.article_id AS articleId, at.tag_id AS tagId,
                  tag.name, at.source, at.confidence
             FROM content_article_tags at
             JOIN content_tags tag
               ON tag.owner_id = at.owner_id AND tag.tag_id = at.tag_id
            WHERE at.owner_id = ? AND at.article_id = ?
            ORDER BY tag.name, at.tag_id`,
          [ownerId, articleId]
        ),
      catch: () => failure("ListArticleTags"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => decodeArticleTag(row, "ListArticleTags"))
      ),
      Effect.map(deepFreeze)
    )

  return {
    listArticleTags,

    // 語彙にないタグIDが1つでも混ざれば、何も書かずに拒む。
    setManualArticleTags: (ownerId, articleId, tagIds, changedAt) =>
      Effect.try({
        try: () =>
          database.transaction(() => {
            if (!ownerHasArticle(database, ownerId, articleId)) {
              return deepFreeze({ _tag: "ArticleNotFound" as const })
            }
            const knownRows =
              tagIds.length === 0
                ? []
                : database.all(
                    `SELECT tag_id AS tagId FROM content_tags
                      WHERE owner_id = ?
                        AND tag_id IN (${tagIds.map(() => "?").join(", ")})`,
                    [ownerId, ...tagIds]
                  )
            const known = new Set(
              knownRows.map(
                (row) => Schema.decodeUnknownSync(IdRowSchema)(row).tagId
              )
            )
            const unknown = tagIds.filter((tagId) => !known.has(tagId))
            if (unknown.length > 0) {
              return deepFreeze({
                _tag: "UnknownTags" as const,
                tagIds: unknown,
              })
            }
            database.run(REPLACE_BY_SOURCE, [ownerId, articleId, "Manual"])
            for (const tagId of tagIds) {
              database.run(
                `INSERT INTO content_article_tags
                  (owner_id, article_id, tag_id, source, confidence, created_at)
                 VALUES (?, ?, ?, 'Manual', NULL, ?)
                 ON CONFLICT(owner_id, article_id, tag_id) DO UPDATE SET
                   source = 'Manual', confidence = NULL,
                   created_at = excluded.created_at`,
                [ownerId, articleId, tagId, changedAt]
              )
            }
            return undefined
          }),
        catch: () => failure("SetArticleTags"),
      }).pipe(
        Effect.flatMap(
          (
            result
          ): Effect.Effect<SetArticleTagsResult, ContentTaxonomyError> => {
            if (result !== undefined) return Effect.succeed(result)
            return listArticleTags(ownerId, articleId).pipe(
              Effect.map((tags) =>
                deepFreeze({ _tag: "Updated" as const, tags })
              )
            )
          }
        )
      ),

    // AIのタグは毎回入れ替え、語彙にない名前だけを候補として数える。
    applyAiTags: (ownerId, articleId, tags, suggestions, changedAt) =>
      Effect.try({
        try: () =>
          database.transaction(() => {
            if (!ownerHasArticle(database, ownerId, articleId)) {
              throw new Error("owner article unavailable")
            }
            database.run(REPLACE_BY_SOURCE, [ownerId, articleId, "Ai"])
            for (const tag of tags) {
              database.run(
                `INSERT INTO content_article_tags
                  (owner_id, article_id, tag_id, source, confidence, created_at)
                 SELECT ?, ?, tag_id, 'Ai', ?, ?
                   FROM content_tags
                  WHERE owner_id = ? AND name = ?
                 ON CONFLICT(owner_id, article_id, tag_id) DO NOTHING`,
                [
                  ownerId,
                  articleId,
                  tag.confidence,
                  changedAt,
                  ownerId,
                  tag.name,
                ]
              )
            }
            for (const name of new Set(suggestions)) {
              const inVocabulary = database.get(
                `SELECT 1 FROM content_tags
                  WHERE owner_id = ? AND name = ?`,
                [ownerId, name]
              )
              if (inVocabulary !== undefined) continue
              database.run(
                `INSERT INTO content_tag_suggestions
                  (owner_id, name, occurrences, last_seen_at)
                 VALUES (?, ?, 1, ?)
                 ON CONFLICT(owner_id, name) DO UPDATE SET
                   occurrences = occurrences + 1,
                   last_seen_at = excluded.last_seen_at`,
                [ownerId, name, changedAt]
              )
            }
          }),
        catch: () => failure("ApplyAiTags"),
      }),
  }
}
