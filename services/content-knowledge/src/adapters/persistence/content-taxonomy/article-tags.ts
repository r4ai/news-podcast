import { deepFreeze } from "@news-podcast/kernel"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"

import {
  contentArticleTags,
  contentTags,
  contentTagSuggestions,
} from "../../../../drizzle/schema.js"
import type {
  ContentTaxonomyError,
  ContentTaxonomyRepository,
  SetArticleTagsResult,
} from "../../../application/content-taxonomy.js"
import type {
  ContentKnowledgeDatabase,
  QueryRunner,
} from "../../../infrastructure/unsafe/drizzle/open.js"
import { decodeArticleTag, failure, ownerHasArticle } from "./row.js"

/**
 * 記事へのタグ付け。手動とAIは同じ表に載るが、互いを上書きしない。
 */
type ArticleTags = Pick<
  ContentTaxonomyRepository,
  "listArticleTags" | "setManualArticleTags" | "applyAiTags"
>

const replaceBySource = (
  runner: QueryRunner,
  ownerId: string,
  articleId: string,
  source: "Manual" | "Ai"
) =>
  runner
    .delete(contentArticleTags)
    .where(
      and(
        eq(contentArticleTags.ownerId, ownerId),
        eq(contentArticleTags.articleId, articleId),
        eq(contentArticleTags.source, source)
      )
    )
    .run()

export const makeArticleTags = (
  database: ContentKnowledgeDatabase
): ArticleTags => {
  const listArticleTags: ContentTaxonomyRepository["listArticleTags"] = (
    ownerId,
    articleId
  ) =>
    Effect.try({
      try: () =>
        database
          .select({
            articleId: contentArticleTags.articleId,
            tagId: contentArticleTags.tagId,
            name: contentTags.name,
            source: contentArticleTags.source,
            confidence: contentArticleTags.confidence,
          })
          .from(contentArticleTags)
          .innerJoin(
            contentTags,
            and(
              eq(contentTags.ownerId, contentArticleTags.ownerId),
              eq(contentTags.tagId, contentArticleTags.tagId)
            )
          )
          .where(
            and(
              eq(contentArticleTags.ownerId, ownerId),
              eq(contentArticleTags.articleId, articleId)
            )
          )
          .orderBy(asc(contentTags.name), asc(contentArticleTags.tagId))
          .all(),
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
          database.transaction((tx) => {
            if (!ownerHasArticle(tx, ownerId, articleId)) {
              return deepFreeze({ _tag: "ArticleNotFound" as const })
            }

            const known = new Set(
              tagIds.length === 0
                ? []
                : tx
                    .select({ tagId: contentTags.tagId })
                    .from(contentTags)
                    .where(
                      and(
                        eq(contentTags.ownerId, ownerId),
                        inArray(contentTags.tagId, [...tagIds])
                      )
                    )
                    .all()
                    .map((row) => row.tagId)
            )
            const unknown = tagIds.filter((tagId) => !known.has(tagId))
            if (unknown.length > 0) {
              return deepFreeze({
                _tag: "UnknownTags" as const,
                tagIds: unknown,
              })
            }

            replaceBySource(tx, ownerId, articleId, "Manual")
            for (const tagId of tagIds) {
              tx.insert(contentArticleTags)
                .values({
                  ownerId,
                  articleId,
                  tagId,
                  source: "Manual",
                  confidence: null,
                  createdAt: changedAt,
                })
                .onConflictDoUpdate({
                  target: [
                    contentArticleTags.ownerId,
                    contentArticleTags.articleId,
                    contentArticleTags.tagId,
                  ],
                  set: {
                    source: "Manual",
                    confidence: null,
                    createdAt: changedAt,
                  },
                })
                .run()
            }
            return undefined
          }),
        catch: () => failure("SetArticleTags"),
      }).pipe(
        Effect.flatMap(
          (
            result
          ): Effect.Effect<SetArticleTagsResult, ContentTaxonomyError> =>
            result !== undefined
              ? Effect.succeed(result)
              : listArticleTags(ownerId, articleId).pipe(
                  Effect.map((tags) =>
                    deepFreeze({ _tag: "Updated" as const, tags })
                  )
                )
        )
      ),

    // AIのタグは毎回入れ替え、語彙にない名前だけを候補として数える。
    applyAiTags: (ownerId, articleId, tags, suggestions, changedAt) =>
      Effect.try({
        try: () =>
          database.transaction((tx) => {
            if (!ownerHasArticle(tx, ownerId, articleId)) {
              throw new Error("owner article unavailable")
            }
            replaceBySource(tx, ownerId, articleId, "Ai")

            for (const tag of tags) {
              // 語彙に存在する名前だけがタグ付けされる。SELECT元が空なら何も入らない。
              tx.insert(contentArticleTags)
                .select(
                  tx
                    .select({
                      ownerId: sql`${ownerId}`.as("owner_id"),
                      articleId: sql`${articleId}`.as("article_id"),
                      tagId: contentTags.tagId,
                      source: sql`'Ai'`.as("source"),
                      confidence: sql`${tag.confidence}`.as("confidence"),
                      createdAt: sql`${changedAt}`.as("created_at"),
                    })
                    .from(contentTags)
                    .where(
                      and(
                        eq(contentTags.ownerId, ownerId),
                        eq(contentTags.name, tag.name)
                      )
                    )
                )
                .onConflictDoNothing({
                  target: [
                    contentArticleTags.ownerId,
                    contentArticleTags.articleId,
                    contentArticleTags.tagId,
                  ],
                })
                .run()
            }

            for (const name of new Set(suggestions)) {
              const inVocabulary = tx
                .select({ name: contentTags.name })
                .from(contentTags)
                .where(
                  and(
                    eq(contentTags.ownerId, ownerId),
                    eq(contentTags.name, name)
                  )
                )
                .get()
              if (inVocabulary !== undefined) continue

              tx.insert(contentTagSuggestions)
                .values({
                  ownerId,
                  name,
                  occurrences: 1,
                  lastSeenAt: changedAt,
                })
                .onConflictDoUpdate({
                  target: [
                    contentTagSuggestions.ownerId,
                    contentTagSuggestions.name,
                  ],
                  set: {
                    occurrences: sql`${contentTagSuggestions.occurrences} + 1`,
                    lastSeenAt: changedAt,
                  },
                })
                .run()
            }
          }),
        catch: () => failure("ApplyAiTags"),
      }).pipe(Effect.asVoid),
  }
}
