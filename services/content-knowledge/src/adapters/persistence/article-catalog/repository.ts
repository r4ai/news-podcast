import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, desc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleOwnerAccess,
  articleOwnerStates,
  articleSnapshots,
  contentArticleTags,
  contentEnrichmentResults,
  contentTags,
  feedItems,
  feedSubscriptions,
} from "../../../../drizzle/schema.js"
import type {
  ArticleCatalog,
  ArticleCatalogError,
  CatalogArticle,
  GenerationCandidate,
} from "../../../application/ports/article-catalog.js"
import { ArticleSnapshotSchema } from "../../../domain/article.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import type { JsonInterop } from "../json-interop.js"
import { latestSnapshotOfArticle } from "../latest-article-snapshot.js"

const RowSchema = Schema.Struct({
  articleId: Schema.String,
  sourceUrl: Schema.String,
  title: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  snapshotJson: Schema.String,
})
const parseRow = parse(RowSchema)

const failure = (
  operation: ArticleCatalogError["operation"],
  reason: ArticleCatalogError["reason"] = "Unavailable"
): ArticleCatalogError =>
  deepFreeze({ _tag: "ArticleCatalogFailed", operation, reason })

const projection = {
  articleId: feedItems.articleId,
  sourceUrl: feedItems.sourceUrl,
  title: feedItems.title,
  publishedAt: feedItems.publishedAt,
  snapshotJson: articleSnapshots.snapshotJson,
}

/** 並びの基準。公開日時が無い記事は発見日時で代替する。 */
const sortKey = sql`COALESCE(${feedItems.publishedAt}, ${feedItems.discoveredAt})`

export const createArticleCatalog = (
  database: ContentKnowledgeDatabase,
  jsonInterop: Pick<JsonInterop, "parse">
): Effect.Effect<ArticleCatalog, ArticleCatalogError> =>
  Effect.sync(() => {
    /**
     * 購読を通じた所有と、アーカイブ済みであることの結合。
     * 非表示にした記事は生成対象に含めない。
     */
    const subscribedArchived = (ownerId: string, extra?: SQL) =>
      database
        .select(projection)
        .from(feedItems)
        .innerJoin(
          feedSubscriptions,
          eq(feedSubscriptions.feedId, feedItems.feedId)
        )
        .leftJoin(
          articleOwnerStates,
          and(
            eq(articleOwnerStates.ownerId, feedSubscriptions.ownerId),
            eq(articleOwnerStates.articleId, feedItems.articleId)
          )
        )
        .innerJoin(
          articleSnapshots,
          and(
            eq(articleSnapshots.articleId, feedItems.articleId),
            latestSnapshotOfArticle
          )
        )
        .where(
          and(
            eq(feedSubscriptions.ownerId, ownerId),
            eq(feedSubscriptions.enabled, 1),
            sql`COALESCE(${articleOwnerStates.hidden}, 0) = 0`,
            ...(extra === undefined ? [] : [extra])
          )
        )

    const accessibleArchived = (ownerId: string, extra?: SQL) =>
      database
        .select(projection)
        .from(feedItems)
        .innerJoin(
          articleOwnerAccess,
          eq(articleOwnerAccess.articleId, feedItems.articleId)
        )
        .leftJoin(
          articleOwnerStates,
          and(
            eq(articleOwnerStates.ownerId, articleOwnerAccess.ownerId),
            eq(articleOwnerStates.articleId, feedItems.articleId)
          )
        )
        .innerJoin(
          articleSnapshots,
          and(
            eq(articleSnapshots.articleId, feedItems.articleId),
            latestSnapshotOfArticle
          )
        )
        .where(
          and(
            eq(articleOwnerAccess.ownerId, ownerId),
            sql`COALESCE(${articleOwnerStates.hidden}, 0) = 0`,
            ...(extra === undefined ? [] : [extra])
          )
        )

    const decodeRows = (rows: readonly unknown[]) =>
      Effect.forEach(rows, (row) =>
        parseRow(row).pipe(
          Effect.flatMap((parsed) =>
            Effect.try({
              try: () => jsonInterop.parse(parsed.snapshotJson),
              catch: () => failure("Find", "CorruptRecord"),
            }).pipe(
              Effect.flatMap((json) => parse(ArticleSnapshotSchema)(json)),
              Effect.map((snapshot) => ({
                snapshot,
                publishedAt: parsed.publishedAt,
              }))
            )
          ),
          Effect.mapError(() => failure("Find", "CorruptRecord")),
          Effect.map(({ snapshot, publishedAt }): CatalogArticle =>
            deepFreeze({
              articleId: snapshot.articleId,
              snapshotId: snapshot.snapshotId,
              title: snapshot.title,
              sourceUrl: snapshot.sourceUrl,
              markdownKey: snapshot.capture.markdown.key,
              ...(typeof publishedAt === "string" ? { publishedAt } : {}),
            })
          )
        )
      ).pipe(Effect.map(deepFreeze))

    const upsert: ArticleCatalog["upsert"] = (input) =>
      Effect.try({
        try: () =>
          database.transaction((tx) => {
            tx.insert(feedItems)
              .values({
                articleId: input.articleId,
                feedId: input.feedId,
                externalId: input.externalId,
                sourceUrl: input.sourceUrl,
                title: input.title,
                publishedAt: input.publishedAt ?? null,
                discoveredAt: input.discoveredAt,
              })
              .onConflictDoUpdate({
                target: [feedItems.feedId, feedItems.externalId],
                set: {
                  sourceUrl: input.sourceUrl,
                  title: input.title,
                  publishedAt: input.publishedAt ?? null,
                },
              })
              .run()

            const article = tx
              .select({ articleId: feedItems.articleId })
              .from(feedItems)
              .where(
                and(
                  eq(feedItems.feedId, input.feedId),
                  eq(feedItems.externalId, input.externalId)
                )
              )
              .get()
            if (article === undefined) throw new Error("article unavailable")

            const owners = tx
              .select({ ownerId: feedSubscriptions.ownerId })
              .from(feedSubscriptions)
              .where(eq(feedSubscriptions.feedId, input.feedId))
              .all()
            if (owners.length > 0)
              tx.insert(articleOwnerAccess)
                .values(
                  owners.map(({ ownerId }) => ({
                    ownerId,
                    articleId: article.articleId,
                    acquiredAt: input.discoveredAt,
                  }))
                )
                .onConflictDoNothing()
                .run()
          }),
        catch: () => failure("Upsert"),
      }).pipe(Effect.asVoid)

    const findAutomatic = (
      ownerId: Parameters<ArticleCatalog["findAutomatic"]>[0],
      limit: number,
      excludedArticleIds: readonly Parameters<
        ArticleCatalog["findSelected"]
      >[1][number][] = []
    ) =>
      Effect.try({
        try: () =>
          subscribedArchived(
            ownerId,
            excludedArticleIds.length === 0
              ? undefined
              : notInArray(feedItems.articleId, [...excludedArticleIds])
          )
            .orderBy(desc(sortKey), desc(feedItems.articleId))
            .limit(limit)
            .all(),
        catch: () => failure("Find"),
      }).pipe(Effect.flatMap(decodeRows))

    /** 指定順を保って返す。SQLのIN句は順序を保証しない。 */
    const findSelected: ArticleCatalog["findSelected"] = (
      ownerId,
      articleIds
    ) => {
      if (articleIds.length === 0) return Effect.succeed([])
      return Effect.try({
        try: () =>
          accessibleArchived(
            ownerId,
            inArray(feedItems.articleId, [...articleIds])
          ).all(),
        catch: () => failure("Find"),
      }).pipe(
        Effect.flatMap(decodeRows),
        Effect.map((articles) => {
          const byId = new Map(
            articles.map((article) => [article.articleId, article])
          )
          return deepFreeze(
            articleIds.flatMap((id) => {
              const article = byId.get(id)
              return article === undefined ? [] : [article]
            })
          )
        })
      )
    }

    const listGenerationCandidates: ArticleCatalog["listGenerationCandidates"] =
      (ownerId, limit, excludedArticleIds) =>
        findAutomatic(ownerId, limit, excludedArticleIds).pipe(
          Effect.flatMap((articles) => {
            if (articles.length === 0) return Effect.succeed([])
            const ids = articles.map((article) => article.articleId)
            return Effect.try({
              try: () => {
                const summaries = database
                  .select({
                    articleId: contentEnrichmentResults.articleId,
                    summary: contentEnrichmentResults.summary,
                  })
                  .from(contentEnrichmentResults)
                  .where(
                    and(
                      eq(contentEnrichmentResults.ownerId, ownerId),
                      eq(contentEnrichmentResults.status, "Succeeded"),
                      inArray(contentEnrichmentResults.articleId, [...ids])
                    )
                  )
                  .all()
                const tagRows = database
                  .select({
                    articleId: contentArticleTags.articleId,
                    name: contentTags.name,
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
                      inArray(contentArticleTags.articleId, [...ids])
                    )
                  )
                  .all()
                const summaryById = new Map(
                  summaries.flatMap((row) =>
                    row.summary === null ? [] : [[row.articleId, row.summary]]
                  )
                )
                const tagsById = new Map<string, string[]>()
                for (const row of tagRows) {
                  const tags = tagsById.get(row.articleId) ?? []
                  tags.push(row.name)
                  tagsById.set(row.articleId, tags)
                }
                return articles.map((article): GenerationCandidate => {
                  const sourceName = new URL(article.sourceUrl).hostname
                  const summary = summaryById.get(article.articleId)
                  return deepFreeze({
                    articleId: article.articleId,
                    title: article.title,
                    sourceName,
                    ...(article.publishedAt === undefined
                      ? {}
                      : { publishedAt: article.publishedAt }),
                    ...(summary === undefined ? {} : { summary }),
                    tags: [...(tagsById.get(article.articleId) ?? [])].sort(),
                  })
                })
              },
              catch: () => failure("Find"),
            })
          }),
          Effect.map(deepFreeze)
        )

    return deepFreeze({
      upsert,
      findAutomatic,
      findSelected,
      listGenerationCandidates,
    })
  })
