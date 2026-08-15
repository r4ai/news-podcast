import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type { ContentTaxonomyError } from "../../application/content-taxonomy.js"
import {
  ArticleTagSchema,
  TagSchema,
  TagSuggestionSchema,
} from "../../domain/content-taxonomy.js"
import type { SqlitePort } from "../sqlite-port.js"

/**
 * タグ語彙の永続化スキーマと、行の復号に共通して使う語彙。
 */

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
export const IdRowSchema = Schema.Struct({ tagId: Schema.String })

export const failure = (
  operation: ContentTaxonomyError["operation"],
  reason: ContentTaxonomyError["reason"] = "Unavailable"
): ContentTaxonomyError =>
  deepFreeze({ _tag: "ContentTaxonomyFailed", operation, reason })

export const decodeTag = (
  row: unknown,
  operation: ContentTaxonomyError["operation"]
) =>
  parse(TagRowSchema)(row).pipe(
    Effect.flatMap((value) => parse(TagSchema)(value)),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const decodeSuggestion = (
  row: unknown,
  operation: ContentTaxonomyError["operation"]
) =>
  parse(SuggestionRowSchema)(row).pipe(
    Effect.flatMap((value) => parse(TagSuggestionSchema)(value)),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const decodeArticleTag = (
  row: unknown,
  operation: ContentTaxonomyError["operation"]
) =>
  parse(ArticleTagRowSchema)(row).pipe(
    Effect.flatMap((value) => parse(ArticleTagSchema)(value)),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

// 購読を通じて所有している記事にだけ、タグを付け外しできる。
export const ownerHasArticle = (
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
