import { deepFreeze, parse } from "@news-podcast/kernel"
import { decodePersistedJson } from "@news-podcast/persistence"
import { and, asc, desc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleOwnerAccess,
  articleOwnerStates,
  articleSnapshots,
  feedItems,
} from "../../../../drizzle/schema.js"
import type {
  ArticleLibraryError,
  ArticleLibraryRepository,
  ArticleListPage,
  ArticleListQuery,
  ArticleLookup,
  ArticleObjectLookup,
  ReplayObjectLookup,
} from "../../../application/article-library.js"
import {
  articleSortKey,
  encodeArticleCursor,
} from "../../../domain/article-library.js"
import {
  ArticleSnapshotSchema,
  ObjectKeySchema,
} from "../../../domain/article.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { keysetFilters, queryFilters } from "./filters.js"
import {
  accessibleByOwner,
  articleProjection,
  decodeArticle,
  failure,
  latestSnapshotOfArticle,
  ownerStateOfArticle,
  parseArticleRow,
  sortKeyExpression,
} from "./projection.js"

/**
 * 記事の読み出し：keysetページングによる一覧と、1件の参照・本文キー解決。
 */
type Reading = Pick<
  ArticleLibraryRepository,
  | "list"
  | "find"
  | "findSnapshot"
  | "findMarkdown"
  | "findSnapshotMarkdown"
  | "findReplayObject"
>

const SnapshotJsonRowSchema = Schema.Struct({ snapshotJson: Schema.String })

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
          .innerJoin(articleOwnerAccess, accessibleByOwner)
          .leftJoin(articleOwnerStates, ownerStateOfArticle)
          .leftJoin(articleSnapshots, latestSnapshotOfArticle)
          .where(
            and(
              eq(articleOwnerAccess.ownerId, ownerId),
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
          .innerJoin(articleOwnerAccess, accessibleByOwner)
          .leftJoin(articleOwnerStates, ownerStateOfArticle)
          .leftJoin(articleSnapshots, latestSnapshotOfArticle)
          .where(
            and(
              eq(articleOwnerAccess.ownerId, ownerId),
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

  const readSnapshot = (
    ownerId: string,
    articleId: string,
    snapshotId: string,
    operation: "FindSnapshot" | "SnapshotMarkdown"
  ) =>
    Effect.try({
      try: () =>
        database
          .select(articleProjection)
          .from(feedItems)
          .innerJoin(articleOwnerAccess, accessibleByOwner)
          .leftJoin(articleOwnerStates, ownerStateOfArticle)
          .innerJoin(
            articleSnapshots,
            and(
              eq(articleSnapshots.articleId, feedItems.articleId),
              eq(articleSnapshots.snapshotId, snapshotId)
            )
          )
          .where(
            and(
              eq(articleOwnerAccess.ownerId, ownerId),
              eq(feedItems.articleId, articleId)
            )
          )
          .limit(1)
          .get(),
      catch: () => failure(operation),
    })

  return {
    list: (ownerId, query) => listPage(ownerId, query, "List"),
    find,
    findSnapshot: (ownerId, articleId, snapshotId) =>
      readSnapshot(ownerId, articleId, snapshotId, "FindSnapshot").pipe(
        Effect.flatMap(
          (row): Effect.Effect<ArticleLookup, ArticleLibraryError> =>
            row === undefined
              ? Effect.succeed(deepFreeze({ _tag: "NotFound" }))
              : decodeArticle(row, "FindSnapshot").pipe(
                  Effect.map((article) =>
                    deepFreeze({ _tag: "Found" as const, article })
                  )
                )
        )
      ),
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
    findSnapshotMarkdown: (ownerId, articleId, snapshotId) =>
      readSnapshot(ownerId, articleId, snapshotId, "SnapshotMarkdown").pipe(
        Effect.flatMap(
          (row): Effect.Effect<ArticleObjectLookup, ArticleLibraryError> => {
            if (row === undefined) {
              return Effect.succeed(deepFreeze({ _tag: "NotFound" }))
            }
            return decodeArticle(row, "SnapshotMarkdown").pipe(
              Effect.andThen(
                parseArticleRow(row).pipe(
                  Effect.mapError(() =>
                    failure("SnapshotMarkdown", "CorruptRecord")
                  ),
                  Effect.flatMap((parsed) =>
                    parsed.markdownKey === null
                      ? Effect.succeed<ArticleObjectLookup>(
                          deepFreeze({ _tag: "NotFound" })
                        )
                      : parse(ObjectKeySchema)(parsed.markdownKey).pipe(
                          Effect.mapError(() =>
                            failure("SnapshotMarkdown", "CorruptRecord")
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
    findReplayObject: (ownerId, snapshotId, object) =>
      Effect.try({
        try: () =>
          database
            .select({ snapshotJson: articleSnapshots.snapshotJson })
            .from(articleSnapshots)
            .innerJoin(
              articleOwnerAccess,
              eq(articleOwnerAccess.articleId, articleSnapshots.articleId)
            )
            .where(
              and(
                eq(articleOwnerAccess.ownerId, ownerId),
                eq(articleSnapshots.snapshotId, snapshotId)
              )
            )
            .limit(1)
            .get(),
        catch: () => failure("ReplayAccess"),
      }).pipe(
        Effect.flatMap(
          (row): Effect.Effect<ReplayObjectLookup, ArticleLibraryError> => {
            if (row === undefined) {
              return Effect.succeed(deepFreeze({ _tag: "NotFound" }))
            }
            return parse(SnapshotJsonRowSchema)(row).pipe(
              Effect.mapError(() => failure("ReplayAccess", "CorruptRecord")),
              Effect.flatMap(({ snapshotJson }) =>
                decodePersistedJson(
                  "article_snapshots.snapshot_json",
                  ArticleSnapshotSchema,
                  snapshotJson
                ).pipe(
                  Effect.mapError(() =>
                    failure("ReplayAccess", "CorruptRecord")
                  )
                )
              ),
              Effect.flatMap((snapshot) => {
                const expectedKey =
                  object.kind === "Replay"
                    ? `articles/${snapshotId}/replay/index.html`
                    : `articles/${snapshotId}/assets/${object.assetName}`
                const candidate =
                  object.kind === "Replay"
                    ? snapshot.capture.replay
                    : snapshot.capture.assets.find(
                        (asset) => asset.key === expectedKey
                      )
                if (candidate === undefined) {
                  return Effect.succeed<ReplayObjectLookup>(
                    deepFreeze({ _tag: "NotFound" })
                  )
                }
                if (
                  snapshot.snapshotId !== snapshotId ||
                  candidate.key !== expectedKey
                ) {
                  return Effect.fail(failure("ReplayAccess", "CorruptRecord"))
                }
                return Effect.succeed<ReplayObjectLookup>(
                  deepFreeze({ _tag: "Found", object: candidate })
                )
              })
            )
          }
        )
      ),
  }
}
