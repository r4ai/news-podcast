import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, asc, eq, sql } from "drizzle-orm"
import { Effect } from "effect"

import {
  articleOwnerStates,
  articleSnapshots,
  feedItems,
  feedSubscriptions,
} from "../../../../drizzle/schema.js"
import type {
  ArticleFacets,
  ArticleLibraryRepository,
} from "../../../application/article-library.js"
import { FeedIdSchema } from "../../../domain/subscription.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { queryFilters } from "./filters.js"
import {
  CountRowSchema,
  failure,
  FeedCountRowSchema,
  latestSnapshotOfArticle,
  ownedBySubscription,
  ownerStateOfArticle,
  stateFlag,
} from "./projection.js"

/**
 * 一覧の絞り込みUIが必要とする件数。状態別の内訳はフィルタから独立させる。
 */
type Facets = Pick<ArticleLibraryRepository, "facets">

const countWhen = (condition: ReturnType<typeof sql>) =>
  sql<number>`COALESCE(SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END), 0)`

export const makeFacets = (database: ContentKnowledgeDatabase): Facets => ({
  facets: (ownerId, query) => {
    // 状態別の件数を出すのが目的なので、状態での絞り込みは外して数える。
    const where = and(
      eq(feedSubscriptions.ownerId, ownerId),
      ...queryFilters({ ...query, state: "All" })
    )

    return Effect.try({
      try: () => ({
        states: database
          .select({
            allCount: sql<number>`COUNT(*)`.as("allCount"),
            unreadCount: countWhen(
              sql`${stateFlag(articleOwnerStates.read)} = 0`
            ).as("unreadCount"),
            savedCount: countWhen(
              sql`${stateFlag(articleOwnerStates.saved)} = 1`
            ).as("savedCount"),
            laterCount: countWhen(
              sql`${stateFlag(articleOwnerStates.readLater)} = 1`
            ).as("laterCount"),
          })
          .from(feedItems)
          .innerJoin(feedSubscriptions, ownedBySubscription)
          .leftJoin(articleOwnerStates, ownerStateOfArticle)
          .leftJoin(articleSnapshots, latestSnapshotOfArticle)
          .where(where)
          .get(),
        feeds: database
          .select({
            feedId: feedItems.feedId,
            count: sql<number>`COUNT(*)`.as("count"),
          })
          .from(feedItems)
          .innerJoin(feedSubscriptions, ownedBySubscription)
          .leftJoin(articleOwnerStates, ownerStateOfArticle)
          .leftJoin(articleSnapshots, latestSnapshotOfArticle)
          .where(where)
          .groupBy(feedItems.feedId)
          .orderBy(asc(feedItems.feedId))
          .all(),
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
