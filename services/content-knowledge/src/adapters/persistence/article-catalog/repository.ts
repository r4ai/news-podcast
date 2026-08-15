import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleOwnerStates,
  articleSnapshots,
  feedItems,
  feedSubscriptions,
} from "../../../../drizzle/schema.js"
import type {
  ArticleCatalog,
  ArticleCatalogError,
  CatalogArticle,
} from "../../../application/ports/article-catalog.js"
import { ArticleSnapshotSchema } from "../../../domain/article.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import type { JsonInterop } from "../json-interop.js"

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
    const ownedArchived = (ownerId: string, extra?: SQL) =>
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
          eq(articleSnapshots.articleId, feedItems.articleId)
        )
        .where(
          and(
            eq(feedSubscriptions.ownerId, ownerId),
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
          database
            .insert(feedItems)
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
            .run(),
        catch: () => failure("Upsert"),
      }).pipe(Effect.asVoid)

    const findAutomatic: ArticleCatalog["findAutomatic"] = (ownerId, limit) =>
      Effect.try({
        try: () =>
          ownedArchived(ownerId)
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
          ownedArchived(
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

    return deepFreeze({ upsert, findAutomatic, findSelected })
  })
