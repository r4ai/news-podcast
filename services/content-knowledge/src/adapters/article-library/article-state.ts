import { Effect, Schema } from "effect"

import type { ArticleLibraryRepository } from "../../application/article-library.js"
import type { SqlitePort } from "../sqlite-port.js"
import { failure, from, queryFilter } from "./query.js"

/**
 * 既読・保存・あとで読む・非表示という、利用者ごとの記事状態の書き込み。
 */

type ArticleState = Pick<ArticleLibraryRepository, "patch" | "bulkPatch">

const IdRowSchema = Schema.Struct({ articleId: Schema.String })

export const makeArticleState = (
  database: SqlitePort,
  find: ArticleLibraryRepository["find"]
): ArticleState => {
  // 部分更新のため、指定のなかった項目は現在値を引き継ぐ。
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
    const resolve = (next: boolean | undefined, previous: number | undefined) =>
      next ?? previous === 1
    const hidden = resolve(patch.hidden, current?.hidden)
    // 非表示にした時刻は、再度非表示にしても最初の時刻を保つ。
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

  return {
    // 所有していない記事は書き込む前に弾き、更新後の姿を読み直して返す。
    patch: (ownerId, articleId, statePatch, changedAt) =>
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
      ),
    bulkPatch: (ownerId, query, statePatch, changedAt) => {
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
              Schema.decodeUnknownSync(IdRowSchema, {
                errors: "all",
                onExcessProperty: "error",
              })(row)
            )
            parsed.forEach(({ articleId }) =>
              applyPatch(ownerId, articleId, statePatch, changedAt)
            )
            return parsed.length
          }),
        catch: () => failure("BulkPatch"),
      })
    },
  }
}
