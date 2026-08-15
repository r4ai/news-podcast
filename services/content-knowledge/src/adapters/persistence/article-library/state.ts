import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleOwnerStates,
  articleSnapshots,
  feedItems,
  feedSubscriptions,
} from "../../../../drizzle/schema.js"
import type { ArticleLibraryRepository } from "../../../application/article-library.js"
import type {
  ContentKnowledgeDatabase,
  QueryRunner,
} from "../../../infrastructure/unsafe/drizzle/open.js"
import { queryFilters } from "./filters.js"
import {
  failure,
  latestSnapshotOfArticle,
  ownedBySubscription,
  ownerStateOfArticle,
} from "./projection.js"

/**
 * 既読・保存・あとで読む・非表示という、利用者ごとの記事状態の書き込み。
 */
type ArticleState = Pick<ArticleLibraryRepository, "patch" | "bulkPatch">

const IdRowSchema = Schema.Struct({ articleId: Schema.String })
const decodeIdRow = Schema.decodeUnknownSync(IdRowSchema, {
  errors: "all",
  onExcessProperty: "error",
})

export const makeArticleState = (
  database: ContentKnowledgeDatabase,
  find: ArticleLibraryRepository["find"]
): ArticleState => {
  // 部分更新のため、指定のなかった項目は現在値を引き継ぐ。
  const applyPatch = (
    runner: QueryRunner,
    ownerId: string,
    articleId: string,
    patch: Parameters<ArticleLibraryRepository["patch"]>[2],
    changedAt: Parameters<ArticleLibraryRepository["patch"]>[3]
  ) => {
    const current = runner
      .select({
        read: articleOwnerStates.read,
        saved: articleOwnerStates.saved,
        readLater: articleOwnerStates.readLater,
        hidden: articleOwnerStates.hidden,
        hiddenAt: articleOwnerStates.hiddenAt,
      })
      .from(articleOwnerStates)
      .where(
        and(
          eq(articleOwnerStates.ownerId, ownerId),
          eq(articleOwnerStates.articleId, articleId)
        )
      )
      .get()

    const resolve = (next: boolean | undefined, previous: number | undefined) =>
      next ?? previous === 1

    const hidden = resolve(patch.hidden, current?.hidden)
    // 非表示にした時刻は、再度非表示にしても最初の時刻を保つ。
    const hiddenAt = hidden ? (current?.hiddenAt ?? changedAt) : null

    const next = {
      read: resolve(patch.read, current?.read) ? 1 : 0,
      saved: resolve(patch.saved, current?.saved) ? 1 : 0,
      readLater: resolve(patch.readLater, current?.readLater) ? 1 : 0,
      hidden: hidden ? 1 : 0,
      hiddenAt,
      updatedAt: changedAt,
    }

    runner
      .insert(articleOwnerStates)
      .values({ ownerId, articleId, ...next })
      .onConflictDoUpdate({
        target: [articleOwnerStates.ownerId, articleOwnerStates.articleId],
        set: next,
      })
      .run()
  }

  return {
    // 所有していない記事は書き込む前に弾き、更新後の姿を読み直して返す。
    patch: (ownerId, articleId, statePatch, changedAt) =>
      find(ownerId, articleId).pipe(
        Effect.flatMap((lookup) => {
          if (lookup._tag === "NotFound") return Effect.succeed(lookup)
          return Effect.try({
            try: () =>
              database.transaction((tx) =>
                applyPatch(tx, ownerId, articleId, statePatch, changedAt)
              ),
            catch: () => failure("Patch"),
          }).pipe(Effect.andThen(find(ownerId, articleId)))
        })
      ),

    bulkPatch: (ownerId, query, statePatch, changedAt) =>
      Effect.try({
        try: () =>
          database.transaction((tx) => {
            const selected = tx
              .select({ articleId: feedItems.articleId })
              .from(feedItems)
              .innerJoin(feedSubscriptions, ownedBySubscription)
              .leftJoin(articleOwnerStates, ownerStateOfArticle)
              .leftJoin(articleSnapshots, latestSnapshotOfArticle)
              .where(
                and(
                  eq(feedSubscriptions.ownerId, ownerId),
                  ...queryFilters(query)
                )
              )
              .all()

            const parsed = selected.map((row) => decodeIdRow(row))
            for (const { articleId } of parsed) {
              applyPatch(tx, ownerId, articleId, statePatch, changedAt)
            }
            return parsed.length
          }),
        catch: () => failure("BulkPatch"),
      }),
  }
}
