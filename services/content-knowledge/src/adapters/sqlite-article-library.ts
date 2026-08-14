import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type {
  ArticleFacets,
  ArticleLibraryError,
  ArticleLibraryRepository,
  ArticleListPage,
  ArticleListQuery,
  ArticleLookup,
  ArticleObjectLookup,
} from "../application/article-library.js"
import { ObjectKeySchema } from "../domain/article.js"
import {
  ArticleViewSchema,
  articleSortKey,
  decodeArticleCursor,
  encodeArticleCursor,
} from "../domain/article-library.js"
import { FeedIdSchema } from "../domain/subscription.js"
import { articleOwnerStatesSchema } from "./sqlite-article-state-schema.js"
import type { SqlitePort } from "./sqlite-port.js"

const schema = `
${articleOwnerStatesSchema}
`

const ArticleRowSchema = Schema.Struct({
  articleId: Schema.String,
  feedId: Schema.String,
  title: Schema.String,
  sourceUrl: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  discoveredAt: Schema.String,
  snapshotId: Schema.NullOr(Schema.String),
  markdownKey: Schema.NullOr(Schema.String),
  read: Schema.Int,
  saved: Schema.Int,
  readLater: Schema.Int,
  hidden: Schema.Int,
  hiddenAt: Schema.NullOr(Schema.String),
})
const parseArticleRow = parse(ArticleRowSchema)

const CountRowSchema = Schema.Struct({
  allCount: Schema.Int,
  unreadCount: Schema.Int,
  savedCount: Schema.Int,
  laterCount: Schema.Int,
})
const FeedCountRowSchema = Schema.Struct({
  feedId: Schema.String,
  count: Schema.Int,
})

const failure = (
  operation: ArticleLibraryError["operation"],
  reason: ArticleLibraryError["reason"] = "Unavailable"
): ArticleLibraryError =>
  deepFreeze({ _tag: "ArticleLibraryFailed", operation, reason })

const from = `
  FROM feed_items i
  JOIN feed_subscriptions sub ON sub.feed_id = i.feed_id
  LEFT JOIN article_owner_states state
    ON state.owner_id = sub.owner_id AND state.article_id = i.article_id
  LEFT JOIN article_snapshots snapshot ON snapshot.rowid = (
    SELECT candidate.rowid
      FROM article_snapshots candidate
     WHERE json_extract(candidate.snapshot_json, '$.articleId') = i.article_id
     ORDER BY candidate.captured_at DESC, candidate.snapshot_id DESC
     LIMIT 1
  )`

const select = `
SELECT i.article_id AS articleId,
       i.feed_id AS feedId,
       i.title AS title,
       i.source_url AS sourceUrl,
       i.published_at AS publishedAt,
       i.discovered_at AS discoveredAt,
       json_extract(snapshot.snapshot_json, '$.snapshotId') AS snapshotId,
       json_extract(snapshot.snapshot_json, '$.capture.markdown.key') AS markdownKey,
       COALESCE(state.read, 0) AS read,
       COALESCE(state.saved, 0) AS saved,
       COALESCE(state.read_later, 0) AS readLater,
       COALESCE(state.hidden, 0) AS hidden,
       state.hidden_at AS hiddenAt
${from}`

const escapeLike = (input: string): string =>
  input.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")

const queryFilter = (
  query: Pick<ArticleListQuery, "state" | "includeHidden" | "feedIds" | "q">
) => {
  const sql: string[] = []
  const parameters: string[] = []
  if (!query.includeHidden) sql.push("COALESCE(state.hidden, 0) = 0")
  if (query.state === "Unread") sql.push("COALESCE(state.read, 0) = 0")
  if (query.state === "Saved") sql.push("COALESCE(state.saved, 0) = 1")
  if (query.state === "Later") sql.push("COALESCE(state.read_later, 0) = 1")
  if (query.feedIds.length > 0) {
    sql.push(`i.feed_id IN (${query.feedIds.map(() => "?").join(", ")})`)
    parameters.push(...query.feedIds)
  }
  if (query.q !== undefined) {
    sql.push("(i.title LIKE ? ESCAPE '\\' OR i.source_url LIKE ? ESCAPE '\\')")
    const pattern = `%${escapeLike(query.q)}%`
    parameters.push(pattern, pattern)
  }
  return deepFreeze({ sql, parameters })
}

/** ORDER BYとカーソル比較で同じ式を使い、並びと継続位置がずれないようにする。 */
const sortKeyExpression = "COALESCE(i.published_at, i.discovered_at)"

/**
 * `(sortKey, articleId)`の辞書式順序で「カーソルより後」を表すkeyset条件。
 * OFFSETと違い、ページ跨ぎで行が挿入・削除されても重複・欠落しない。
 */
const keysetFilter = (query: Pick<ArticleListQuery, "cursor" | "order">) => {
  const position =
    query.cursor === undefined ? undefined : decodeArticleCursor(query.cursor)
  if (position === undefined) return deepFreeze({ sql: [], parameters: [] })
  const comparison = query.order === "Newest" ? "<" : ">"
  return deepFreeze({
    sql: [
      `(${sortKeyExpression} ${comparison} ? OR (${sortKeyExpression} = ? AND i.article_id ${comparison} ?))`,
    ],
    parameters: [position.sortKey, position.sortKey, position.articleId],
  })
}

const decodeArticle = (
  row: unknown,
  operation: ArticleLibraryError["operation"]
) =>
  parseArticleRow(row).pipe(
    Effect.flatMap((parsed) =>
      parse(ArticleViewSchema)({
        articleId: parsed.articleId,
        feedId: parsed.feedId,
        title: parsed.title,
        sourceUrl: parsed.sourceUrl,
        publishedAt: parsed.publishedAt,
        discoveredAt: parsed.discoveredAt,
        archiveStatus: parsed.snapshotId === null ? "Pending" : "Succeeded",
        snapshotId: parsed.snapshotId,
        state: {
          read: parsed.read === 1,
          saved: parsed.saved === 1,
          readLater: parsed.readLater === 1,
          hidden: parsed.hidden === 1,
          hiddenAt: parsed.hiddenAt,
        },
      })
    ),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const createSqliteArticleLibrary = (
  database: SqlitePort
): Effect.Effect<ArticleLibraryRepository, ArticleLibraryError> =>
  Effect.try({
    try: () => database.execute(schema),
    catch: () => failure("Patch"),
  }).pipe(
    Effect.map(() => {
      const rows = (
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

      const find: ArticleLibraryRepository["find"] = (ownerId, articleId) =>
        Effect.try({
          try: () =>
            database.get(
              `${select} WHERE sub.owner_id = ? AND i.article_id = ? LIMIT 1`,
              [ownerId, articleId]
            ),
          catch: () => failure("Find"),
        }).pipe(
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

      const findMarkdown: ArticleLibraryRepository["findMarkdown"] = (
        ownerId,
        articleId
      ) =>
        Effect.try({
          try: () =>
            database.get(
              `${select} WHERE sub.owner_id = ? AND i.article_id = ? LIMIT 1`,
              [ownerId, articleId]
            ),
          catch: () => failure("Find"),
        }).pipe(
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
        )

      const applyPatch = (
        ownerId: string,
        articleId: string,
        patch: Parameters<ArticleLibraryRepository["patch"]>[2],
        changedAt: Parameters<ArticleLibraryRepository["patch"]>[3]
      ) => {
        const current = database.get(
          `SELECT read, saved, read_later AS readLater, hidden, hidden_at AS hiddenAt
             FROM article_owner_states
            WHERE owner_id = ? AND article_id = ?`,
          [ownerId, articleId]
        ) as
          | {
              readonly read: number
              readonly saved: number
              readonly readLater: number
              readonly hidden: number
              readonly hiddenAt: string | null
            }
          | undefined
        const resolve = (
          next: boolean | undefined,
          previous: number | undefined
        ) => next ?? previous === 1
        const hidden = resolve(patch.hidden, current?.hidden)
        const hiddenAt = hidden ? (current?.hiddenAt ?? changedAt) : null
        database.run(
          `INSERT INTO article_owner_states
             (owner_id, article_id, read, saved, read_later, hidden, hidden_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_id, article_id) DO UPDATE SET
             read = excluded.read,
             saved = excluded.saved,
             read_later = excluded.read_later,
             hidden = excluded.hidden,
             hidden_at = excluded.hidden_at,
             updated_at = excluded.updated_at`,
          [
            ownerId,
            articleId,
            resolve(patch.read, current?.read) ? 1 : 0,
            resolve(patch.saved, current?.saved) ? 1 : 0,
            resolve(patch.readLater, current?.readLater) ? 1 : 0,
            hidden ? 1 : 0,
            hiddenAt,
            changedAt,
          ]
        )
      }

      const patch: ArticleLibraryRepository["patch"] = (
        ownerId,
        articleId,
        statePatch,
        changedAt
      ) =>
        find(ownerId, articleId).pipe(
          Effect.flatMap((lookup) => {
            if (lookup._tag === "NotFound") return Effect.succeed(lookup)
            return Effect.try({
              try: () =>
                database.transaction(() =>
                  applyPatch(ownerId, articleId, statePatch, changedAt)
                ),
              catch: () => failure("Patch"),
            }).pipe(Effect.andThen(find(ownerId, articleId)))
          })
        )

      const bulkPatch: ArticleLibraryRepository["bulkPatch"] = (
        ownerId,
        query,
        statePatch,
        changedAt
      ) => {
        const filter = queryFilter(query)
        return Effect.try({
          try: () =>
            database.transaction(() => {
              const selected = database.all(
                `SELECT i.article_id AS articleId ${from}
                  WHERE ${["sub.owner_id = ?", ...filter.sql].join(" AND ")}`,
                [ownerId, ...filter.parameters]
              )
              const parsed = selected.map((row) =>
                Schema.decodeUnknownSync(
                  Schema.Struct({ articleId: Schema.String }),
                  { errors: "all", onExcessProperty: "error" }
                )(row)
              )
              parsed.forEach(({ articleId }) =>
                applyPatch(ownerId, articleId, statePatch, changedAt)
              )
              return parsed.length
            }),
          catch: () => failure("BulkPatch"),
        })
      }

      const facets: ArticleLibraryRepository["facets"] = (ownerId, query) => {
        const filter = queryFilter({ ...query, state: "All" })
        const where = ["sub.owner_id = ?", ...filter.sql].join(" AND ")
        const parameters = [ownerId, ...filter.parameters]
        return Effect.try({
          try: () => ({
            states: database.get(
              `SELECT COUNT(*) AS allCount,
                      COALESCE(SUM(CASE WHEN COALESCE(state.read, 0) = 0 THEN 1 ELSE 0 END), 0) AS unreadCount,
                      COALESCE(SUM(CASE WHEN COALESCE(state.saved, 0) = 1 THEN 1 ELSE 0 END), 0) AS savedCount,
                      COALESCE(SUM(CASE WHEN COALESCE(state.read_later, 0) = 1 THEN 1 ELSE 0 END), 0) AS laterCount
                 ${from} WHERE ${where}`,
              parameters
            ),
            feeds: database.all(
              `SELECT i.feed_id AS feedId, COUNT(*) AS count
                 ${from} WHERE ${where}
                GROUP BY i.feed_id ORDER BY i.feed_id`,
              parameters
            ),
          }),
          catch: () => failure("Facets"),
        }).pipe(
          Effect.flatMap(({ states, feeds }) =>
            Effect.all([
              parse(CountRowSchema)(states),
              Effect.forEach(feeds, (row) =>
                parse(FeedCountRowSchema)(row).pipe(
                  Effect.flatMap((value) =>
                    parse(FeedIdSchema)(value.feedId).pipe(
                      Effect.map((feedId) =>
                        deepFreeze({ feedId, count: value.count })
                      )
                    )
                  )
                )
              ),
            ]).pipe(Effect.mapError(() => failure("Facets", "CorruptRecord")))
          ),
          Effect.map(([states, feeds]): ArticleFacets =>
            deepFreeze({
              states: {
                all: states.allCount,
                unread: states.unreadCount,
                saved: states.savedCount,
                later: states.laterCount,
              },
              feeds,
            })
          )
        )
      }

      return deepFreeze({
        list: (ownerId, query) => rows(ownerId, query, "List"),
        find,
        findMarkdown,
        patch,
        bulkPatch,
        facets,
      })
    })
  )
