import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type {
  ArticleCatalog,
  ArticleCatalogError,
  CatalogArticle,
} from "../application/article-catalog-ports.js"
import { ArticleSnapshotSchema } from "../domain/article.js"
import type { JsonInterop, SqlitePort } from "./sqlite-port.js"

const schema = `
CREATE TABLE IF NOT EXISTS feed_items (
  article_id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feed_catalog(feed_id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT,
  discovered_at TEXT NOT NULL,
  UNIQUE(feed_id, external_id)
) STRICT;
CREATE INDEX IF NOT EXISTS feed_items_latest
  ON feed_items(feed_id, published_at DESC, discovered_at DESC, article_id DESC);
`

const rowSchema = Schema.Struct({
  articleId: Schema.String,
  sourceUrl: Schema.String,
  title: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  snapshotJson: Schema.String,
})
const parseRow = parse(rowSchema)

const failure = (
  operation: ArticleCatalogError["operation"],
  reason: ArticleCatalogError["reason"] = "Unavailable"
): ArticleCatalogError =>
  deepFreeze({ _tag: "ArticleCatalogFailed", operation, reason })

const baseQuery = `
SELECT i.article_id AS articleId,
       i.source_url AS sourceUrl,
       i.title AS title,
       i.published_at AS publishedAt,
       s.snapshot_json AS snapshotJson
  FROM feed_items i
  JOIN feed_subscriptions sub ON sub.feed_id = i.feed_id
  JOIN article_snapshots s ON json_extract(s.snapshot_json, '$.articleId') = i.article_id
 WHERE sub.owner_id = ?`

export const createSqliteArticleCatalog = (
  database: SqlitePort,
  jsonInterop: Pick<JsonInterop, "parse">
): Effect.Effect<ArticleCatalog, ArticleCatalogError> =>
  Effect.try({
    try: () => database.execute(schema),
    catch: () => failure("Upsert"),
  }).pipe(
    Effect.map(() => {
      const decodeRows = (rows: readonly unknown[]) =>
        Effect.forEach(rows, (row) =>
          parseRow(row).pipe(
            Effect.flatMap((parsed) =>
              Effect.try({
                try: () => jsonInterop.parse(parsed.snapshotJson),
                catch: () => failure("Find", "CorruptRecord"),
              }).pipe(
                Effect.flatMap((json) => parse(ArticleSnapshotSchema)(json))
              )
            ),
            Effect.mapError(() => failure("Find", "CorruptRecord")),
            Effect.map((snapshot): CatalogArticle =>
              deepFreeze({
                articleId: snapshot.articleId,
                snapshotId: snapshot.snapshotId,
                title: snapshot.title,
                sourceUrl: snapshot.sourceUrl,
                markdownKey: snapshot.capture.markdown.key,
                ...(row !== null &&
                typeof row === "object" &&
                typeof (row as { publishedAt?: unknown }).publishedAt ===
                  "string"
                  ? {
                      publishedAt: (row as { publishedAt: string }).publishedAt,
                    }
                  : {}),
              })
            )
          )
        ).pipe(Effect.map(deepFreeze))

      const upsert: ArticleCatalog["upsert"] = (input) =>
        Effect.try({
          try: () => {
            database.run(
              `INSERT INTO feed_items
              (article_id, feed_id, external_id, source_url, title, published_at, discovered_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(feed_id, external_id) DO UPDATE SET
               source_url = excluded.source_url,
               title = excluded.title,
               published_at = excluded.published_at`,
              [
                input.articleId,
                input.feedId,
                input.externalId,
                input.sourceUrl,
                input.title,
                input.publishedAt ?? null,
                input.discoveredAt,
              ]
            )
          },
          catch: () => failure("Upsert"),
        })

      const findAutomatic: ArticleCatalog["findAutomatic"] = (ownerId, limit) =>
        Effect.try({
          try: () =>
            database.all(
              `${baseQuery}
             ORDER BY COALESCE(i.published_at, i.discovered_at) DESC, i.article_id DESC
             LIMIT ?`,
              [ownerId, limit]
            ),
          catch: () => failure("Find"),
        }).pipe(Effect.flatMap(decodeRows))

      const findSelected: ArticleCatalog["findSelected"] = (
        ownerId,
        articleIds
      ) => {
        if (articleIds.length === 0) return Effect.succeed([])
        const placeholders = articleIds.map(() => "?").join(", ")
        return Effect.try({
          try: () =>
            database.all(`${baseQuery} AND i.article_id IN (${placeholders})`, [
              ownerId,
              ...articleIds,
            ]),
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
  )
