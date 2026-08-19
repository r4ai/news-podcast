import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleOwnerAccess,
  contentTags,
  feedItems,
} from "../../../../drizzle/schema.js"
import type { ContentTaxonomyError } from "../../../application/content-taxonomy.js"
import {
  ArticleTagSchema,
  TagSchema,
  TagSuggestionSchema,
} from "../../../domain/content-taxonomy.js"
import type { QueryRunner } from "../../../infrastructure/unsafe/drizzle/open.js"

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

export const failure = (
  operation: ContentTaxonomyError["operation"],
  reason: ContentTaxonomyError["reason"] = "Unavailable"
): ContentTaxonomyError =>
  deepFreeze({ _tag: "ContentTaxonomyFailed", operation, reason })

export const tagProjection = {
  tagId: contentTags.tagId,
  name: contentTags.name,
  createdAt: contentTags.createdAt,
}

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

/** 恒久アクセス権を持つ記事にだけ、タグを付け外しできる。 */
export const ownerHasArticle = (
  runner: QueryRunner,
  ownerId: string,
  articleId: string
): boolean =>
  runner
    .select({ articleId: feedItems.articleId })
    .from(feedItems)
    .innerJoin(
      articleOwnerAccess,
      eq(articleOwnerAccess.articleId, feedItems.articleId)
    )
    .where(
      and(
        eq(articleOwnerAccess.ownerId, ownerId),
        eq(feedItems.articleId, articleId)
      )
    )
    .limit(1)
    .get() !== undefined
