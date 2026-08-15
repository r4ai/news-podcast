import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, asc, desc, eq } from "drizzle-orm"
import { Effect } from "effect"

import {
  articleOwnerStates,
  articleSnapshots,
  feedItems,
  feedSubscriptions,
} from "../../../../drizzle/schema.js"
import type {
  ArticleLibraryError,
  ArticleLibraryRepository,
  ArticleListPage,
  ArticleListQuery,
  ArticleLookup,
  ArticleObjectLookup,
} from "../../../application/article-library.js"
import {
  articleSortKey,
  encodeArticleCursor,
} from "../../../domain/article-library.js"
import { ObjectKeySchema } from "../../../domain/article.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { keysetFilters, queryFilters } from "./filters.js"
import {
  articleProjection,
  decodeArticle,
  failure,
  latestSnapshotOfArticle,
  ownedBySubscription,
  ownerStateOfArticle,
  parseArticleRow,
  sortKeyExpression,
} from "./projection.js"

/**
 * 記事の読み出し：keysetページングによる一覧と、1件の参照・本文キー解決。
 */
type Reading = Pick<ArticleLibraryRepository, "list" | "find" | "findMarkdown">

export const makeReading = (database: ContentKnowledgeDatabase): Reading => {
  const listPage = (
    ownerId: string,
    query: ArticleListQuery,
    operation: ArticleLibraryError["operation"]
  ): Effect.Effect<ArticleListPage, ArticleLibraryError> => {
    const order =
      query.order === "Newest"
        ? [desc(sortKeyExpression), desc(feedItems.articleId)]
        : [asc(sortKeyExpression), asc(feedItems.articleId)]

    return Effect.try({
      try: () =>
        // 次ページの有無は1件多く読んで判定する。COUNTの二重走査を避ける。
        database
          .select(articleProjection)
          .from(feedItems)
          .innerJoin(feedSubscriptions, ownedBySubscription)
          .leftJoin(articleOwnerStates, ownerStateOfArticle)
          .leftJoin(articleSnapshots, latestSnapshotOfArticle)
          .where(
            and(
              eq(feedSubscriptions.ownerId, ownerId),
              ...queryFilters(query),
              ...keysetFilters(query)
            )
          )
          .orderBy(...order)
          .limit(query.limit + 1)
          .all(),
      catch: () => failure(operation),
    }).pipe(
      Effect.flatMap((found) =>
        Effect.forEach(found.slice(0, query.limit), (row) =>
          decodeArticle(row, operation)
        ).pipe(
          Effect.map((items) => {
            const last = items.at(-1)
            return deepFreeze({
              items,
              nextCursor:
                found.length > query.limit && last !== undefined
                  ? encodeArticleCursor({
                      sortKey: articleSortKey(last) as never,
                      articleId: last.articleId,
                    })
                  : null,
            })
          })
        )
      )
    )
  }

  const readOne = (ownerId: string, articleId: string) =>
    Effect.try({
      try: () =>
        database
          .select(articleProjection)
          .from(feedItems)
          .innerJoin(feedSubscriptions, ownedBySubscription)
          .leftJoin(articleOwnerStates, ownerStateOfArticle)
          .leftJoin(articleSnapshots, latestSnapshotOfArticle)
          .where(
            and(
              eq(feedSubscriptions.ownerId, ownerId),
              eq(feedItems.articleId, articleId)
            )
          )
          .limit(1)
          .get(),
      catch: () => failure("Find"),
    })

  const find: ArticleLibraryRepository["find"] = (ownerId, articleId) =>
    readOne(ownerId, articleId).pipe(
      Effect.flatMap(
        (row): Effect.Effect<ArticleLookup, ArticleLibraryError> =>
          row === undefined
            ? Effect.succeed(deepFreeze({ _tag: "NotFound" }))
            : decodeArticle(row, "Find").pipe(
                Effect.map((article) =>
                  deepFreeze({ _tag: "Found" as const, article })
                )
              )
      )
    )

  return {
    list: (ownerId, query) => listPage(ownerId, query, "List"),
    find,
    // 本文が未取得の記事は、記事自体は見えていても本文としては「無い」。
    findMarkdown: (ownerId, articleId) =>
      readOne(ownerId, articleId).pipe(
        Effect.flatMap(
          (row): Effect.Effect<ArticleObjectLookup, ArticleLibraryError> => {
            if (row === undefined) {
              return Effect.succeed(deepFreeze({ _tag: "NotFound" }))
            }
            return decodeArticle(row, "Find").pipe(
              Effect.andThen(
                parseArticleRow(row).pipe(
                  Effect.mapError(() => failure("Find", "CorruptRecord")),
                  Effect.flatMap((parsed) =>
                    parsed.markdownKey === null
                      ? Effect.succeed<ArticleObjectLookup>(
                          deepFreeze({ _tag: "NotFound" })
                        )
                      : parse(ObjectKeySchema)(parsed.markdownKey).pipe(
                          Effect.mapError(() =>
                            failure("Find", "CorruptRecord")
                          ),
                          Effect.map((key): ArticleObjectLookup =>
                            deepFreeze({ _tag: "Found", key })
                          )
                        )
                  )
                )
              )
            )
          }
        )
      ),
  }
}
