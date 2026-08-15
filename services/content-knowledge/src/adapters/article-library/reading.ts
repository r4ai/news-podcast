import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  ArticleLibraryError,
  ArticleLibraryRepository,
  ArticleListPage,
  ArticleListQuery,
  ArticleLookup,
  ArticleObjectLookup,
} from "../../application/article-library.js"
import { ObjectKeySchema } from "../../domain/article.js"
import {
  articleSortKey,
  encodeArticleCursor,
} from "../../domain/article-library.js"
import type { SqlitePort } from "../sqlite-port.js"
import {
  decodeArticle,
  failure,
  keysetFilter,
  parseArticleRow,
  queryFilter,
  select,
  sortKeyExpression,
} from "./query.js"

/**
 * 記事の読み出し：keysetページングによる一覧と、1件の参照・本文キー解決。
 */

type Reading = Pick<ArticleLibraryRepository, "list" | "find" | "findMarkdown">

export const makeReading = (database: SqlitePort): Reading => {
  const listPage = (
    ownerId: string,
    query: ArticleListQuery,
    operation: ArticleLibraryError["operation"]
  ): Effect.Effect<ArticleListPage, ArticleLibraryError> => {
    const filter = queryFilter(query)
    const keyset = keysetFilter(query)
    const where = ["sub.owner_id = ?", ...filter.sql, ...keyset.sql].join(
      " AND "
    )
    const order =
      query.order === "Newest"
        ? `${sortKeyExpression} DESC, i.article_id DESC`
        : `${sortKeyExpression} ASC, i.article_id ASC`
    return Effect.try({
      try: () =>
        // 次ページの有無は1件多く読んで判定する。COUNTの二重走査を避ける。
        database.all(`${select} WHERE ${where} ORDER BY ${order} LIMIT ?`, [
          ownerId,
          ...filter.parameters,
          ...keyset.parameters,
          query.limit + 1,
        ]),
      catch: () => failure(operation),
    }).pipe(
      Effect.flatMap((found) =>
        Effect.forEach(found.slice(0, query.limit), (row) =>
          decodeArticle(row, operation)
        ).pipe(
          Effect.map((items) =>
            deepFreeze({
              items,
              nextCursor:
                found.length > query.limit && items.at(-1) !== undefined
                  ? encodeArticleCursor({
                      sortKey: articleSortKey(items.at(-1)!) as never,
                      articleId: items.at(-1)!.articleId,
                    })
                  : null,
            })
          )
        )
      )
    )
  }

  const readOne = (ownerId: string, articleId: string) =>
    Effect.try({
      try: () =>
        database.get(
          `${select} WHERE sub.owner_id = ? AND i.article_id = ? LIMIT 1`,
          [ownerId, articleId]
        ),
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
