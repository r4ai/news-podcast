import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  ArticleFacets,
  ArticleLibraryRepository,
} from "../../application/article-library.js"
import { FeedIdSchema } from "../../domain/subscription.js"
import type { SqlitePort } from "../sqlite-port.js"
import {
  CountRowSchema,
  FeedCountRowSchema,
  failure,
  from,
  queryFilter,
} from "./query.js"

/**
 * 一覧の絞り込みUIが必要とする件数。状態別の内訳はフィルタから独立させる。
 */

type Facets = Pick<ArticleLibraryRepository, "facets">

export const makeFacets = (database: SqlitePort): Facets => ({
  facets: (ownerId, query) => {
    // 状態別の件数を出すのが目的なので、状態での絞り込みは外して数える。
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
  },
})
