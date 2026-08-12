import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type {
  ContentTaxonomyError,
  ContentTaxonomyRepository,
  PromoteSuggestionResult,
  SetArticleTagsResult,
} from "../application/content-taxonomy.js"
import {
  ArticleTagSchema,
  TagNameSchema,
  TagSchema,
  TagSuggestionSchema,
} from "../domain/content-taxonomy.js"
import type { SqlitePort } from "./sqlite-port.js"

export const contentTaxonomySchema = `
CREATE TABLE IF NOT EXISTS content_tags (
  tag_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, name),
  UNIQUE(owner_id, tag_id)
) STRICT;
CREATE TABLE IF NOT EXISTS content_article_tags (
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES feed_items(article_id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('Manual', 'Ai')),
  confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, article_id, tag_id),
  FOREIGN KEY(owner_id, tag_id)
    REFERENCES content_tags(owner_id, tag_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS content_article_tags_article
  ON content_article_tags(owner_id, article_id, source);
CREATE TABLE IF NOT EXISTS content_tag_suggestions (
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK(occurrences > 0),
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, name)
) STRICT;
`

const TagRowSchema = Schema.Struct({
  tagId: Schema.String,
  name: Schema.String,
  createdAt: Schema.String,
})
const SuggestionRowSchema = Schema.Struct({
  name: Schema.String,
  occurrences: Schema.Int,
  lastSeenAt: Schema.String,
})
const ArticleTagRowSchema = Schema.Struct({
  articleId: Schema.String,
  tagId: Schema.String,
  name: Schema.String,
  source: Schema.String,
  confidence: Schema.NullOr(Schema.Number),
})
const IdRowSchema = Schema.Struct({ tagId: Schema.String })

const failure = (
  operation: ContentTaxonomyError["operation"],
  reason: ContentTaxonomyError["reason"] = "Unavailable"
): ContentTaxonomyError =>
  deepFreeze({ _tag: "ContentTaxonomyFailed", operation, reason })

const decodeTag = (
  row: unknown,
  operation: ContentTaxonomyError["operation"]
) =>
  parse(TagRowSchema)(row).pipe(
    Effect.flatMap((value) => parse(TagSchema)(value)),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const decodeSuggestion = (
  row: unknown,
  operation: ContentTaxonomyError["operation"]
) =>
  parse(SuggestionRowSchema)(row).pipe(
    Effect.flatMap((value) => parse(TagSuggestionSchema)(value)),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const decodeArticleTag = (
  row: unknown,
  operation: ContentTaxonomyError["operation"]
) =>
  parse(ArticleTagRowSchema)(row).pipe(
    Effect.flatMap((value) => parse(ArticleTagSchema)(value)),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const ownerHasArticle = (
  database: SqlitePort,
  ownerId: string,
  articleId: string
): boolean =>
  database.get(
    `SELECT 1
       FROM feed_items i
       JOIN feed_subscriptions sub ON sub.feed_id = i.feed_id
      WHERE sub.owner_id = ? AND i.article_id = ?
      LIMIT 1`,
    [ownerId, articleId]
  ) !== undefined

export const createSqliteContentTaxonomy = (
  database: SqlitePort
): Effect.Effect<ContentTaxonomyRepository, ContentTaxonomyError> =>
  Effect.try({
    try: () => database.execute(contentTaxonomySchema),
    catch: () => failure("CreateTag"),
  }).pipe(
    Effect.map(() => {
      const listTags: ContentTaxonomyRepository["listTags"] = (ownerId) =>
        Effect.try({
          try: () =>
            database.all(
              `SELECT tag_id AS tagId, name, created_at AS createdAt
                 FROM content_tags
                WHERE owner_id = ?
                ORDER BY name, tag_id`,
              [ownerId]
            ),
          catch: () => failure("ListTags"),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) => decodeTag(row, "ListTags"))
          ),
          Effect.map(deepFreeze)
        )

      const createTag: ContentTaxonomyRepository["createTag"] = (
        ownerId,
        tag
      ) =>
        Effect.try({
          try: () => {
            database.run(
              `INSERT INTO content_tags(tag_id, owner_id, name, created_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(owner_id, name) DO NOTHING`,
              [tag.tagId, ownerId, tag.name, tag.createdAt]
            )
            return database.get(
              `SELECT tag_id AS tagId, name, created_at AS createdAt
                 FROM content_tags
                WHERE owner_id = ? AND name = ?`,
              [ownerId, tag.name]
            )
          },
          catch: () => failure("CreateTag"),
        }).pipe(Effect.flatMap((row) => decodeTag(row, "CreateTag")))

      const deleteTag: ContentTaxonomyRepository["deleteTag"] = (
        ownerId,
        tagId
      ) =>
        Effect.try({
          try: () =>
            Number(
              database.run(
                "DELETE FROM content_tags WHERE owner_id = ? AND tag_id = ?",
                [ownerId, tagId]
              ).changes
            ) === 1,
          catch: () => failure("DeleteTag"),
        })

      const listSuggestions: ContentTaxonomyRepository["listSuggestions"] = (
        ownerId
      ) =>
        Effect.try({
          try: () =>
            database.all(
              `SELECT name, occurrences, last_seen_at AS lastSeenAt
                 FROM content_tag_suggestions
                WHERE owner_id = ?
                ORDER BY occurrences DESC, last_seen_at DESC, name`,
              [ownerId]
            ),
          catch: () => failure("ListSuggestions"),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              decodeSuggestion(row, "ListSuggestions")
            )
          ),
          Effect.map(deepFreeze)
        )

      const promoteSuggestion: ContentTaxonomyRepository["promoteSuggestion"] =
        (ownerId, name, tag) =>
          Effect.try({
            try: () =>
              database.transaction(() => {
                const suggestion = database.get(
                  `SELECT 1 FROM content_tag_suggestions
                    WHERE owner_id = ? AND name = ?`,
                  [ownerId, name]
                )
                if (suggestion === undefined) return undefined
                database.run(
                  `INSERT INTO content_tags(tag_id, owner_id, name, created_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(owner_id, name) DO NOTHING`,
                  [tag.tagId, ownerId, tag.name, tag.createdAt]
                )
                database.run(
                  `DELETE FROM content_tag_suggestions
                    WHERE owner_id = ? AND name = ?`,
                  [ownerId, name]
                )
                return database.get(
                  `SELECT tag_id AS tagId, name, created_at AS createdAt
                     FROM content_tags
                    WHERE owner_id = ? AND name = ?`,
                  [ownerId, name]
                )
              }),
            catch: () => failure("PromoteSuggestion"),
          }).pipe(
            Effect.flatMap(
              (
                row
              ): Effect.Effect<
                PromoteSuggestionResult,
                ContentTaxonomyError
              > =>
                row === undefined
                  ? Effect.succeed(deepFreeze({ _tag: "NotFound" }))
                  : decodeTag(row, "PromoteSuggestion").pipe(
                      Effect.map((promoted) =>
                        deepFreeze({ _tag: "Promoted" as const, tag: promoted })
                      )
                    )
            )
          )

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
            Effect.forEach(rows, (row) =>
              decodeArticleTag(row, "ListArticleTags")
            )
          ),
          Effect.map(deepFreeze)
        )

      const setManualArticleTags: ContentTaxonomyRepository["setManualArticleTags"] =
        (ownerId, articleId, tagIds, changedAt) =>
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
                database.run(
                  `DELETE FROM content_article_tags
                    WHERE owner_id = ? AND article_id = ? AND source = 'Manual'`,
                  [ownerId, articleId]
                )
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
          )

      const vocabulary: ContentTaxonomyRepository["vocabulary"] = (ownerId) =>
        Effect.try({
          try: () =>
            database.all(
              "SELECT name FROM content_tags WHERE owner_id = ? ORDER BY name",
              [ownerId]
            ),
          catch: () => failure("ListTags"),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              parse(Schema.Struct({ name: Schema.String }))(row).pipe(
                Effect.flatMap(({ name }) => parse(TagNameSchema)(name)),
                Effect.mapError(() => failure("ListTags", "CorruptRecord"))
              )
            )
          ),
          Effect.map(deepFreeze)
        )

      const applyAiTags: ContentTaxonomyRepository["applyAiTags"] = (
        ownerId,
        articleId,
        tags,
        suggestions,
        changedAt
      ) =>
        Effect.try({
          try: () =>
            database.transaction(() => {
              if (!ownerHasArticle(database, ownerId, articleId)) {
                throw new Error("owner article unavailable")
              }
              database.run(
                `DELETE FROM content_article_tags
                  WHERE owner_id = ? AND article_id = ? AND source = 'Ai'`,
                [ownerId, articleId]
              )
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
              const uniqueSuggestions = new Set(suggestions)
              for (const name of uniqueSuggestions) {
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
        })

      return deepFreeze({
        listTags,
        createTag,
        deleteTag,
        listSuggestions,
        promoteSuggestion,
        setManualArticleTags,
        listArticleTags,
        vocabulary,
        applyAiTags,
      })
    })
  )
