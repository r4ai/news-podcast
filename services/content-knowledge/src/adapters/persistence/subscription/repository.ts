import { deepFreeze, parse } from "@news-podcast/kernel"
import { and, asc, eq, exists, like, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

import {
  articleOwnerAccess,
  feedCatalog,
  feedItems,
  feedSubscriptions,
} from "../../../../drizzle/schema.js"
import type {
  SubscriptionRepository,
  SubscriptionStateResult,
  SubscriptionStoreError,
} from "../../../application/ports/subscription.js"
import {
  FeedSubscriptionSchema,
  PollingFeedSchema,
} from "../../../domain/subscription.js"
import type { ContentKnowledgeDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import { escapeLikePattern } from "../like.js"

const SubscriptionRowSchema = Schema.Struct({
  subscriptionId: Schema.String,
  feedId: Schema.String,
  ownerId: Schema.String,
  feedUrl: Schema.String,
  enabled: Schema.Int,
  createdAt: Schema.String,
})
const FeedRowSchema = Schema.Struct({
  feedId: Schema.String,
  feedUrl: Schema.String,
})
const parseSubscriptionRow = parse(SubscriptionRowSchema)
const parseFeedRow = parse(FeedRowSchema)

const failure = (
  operation: SubscriptionStoreError["operation"],
  reason: SubscriptionStoreError["reason"] = "Unavailable"
): SubscriptionStoreError =>
  deepFreeze({ _tag: "SubscriptionStoreFailed" as const, operation, reason })

const decodeSubscription = (
  row: unknown,
  operation: SubscriptionStoreError["operation"]
) =>
  parseSubscriptionRow(row).pipe(
    Effect.flatMap((value) =>
      parse(FeedSubscriptionSchema)({ ...value, enabled: value.enabled === 1 })
    ),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const subscriptionProjection = {
  subscriptionId: feedSubscriptions.subscriptionId,
  feedId: feedSubscriptions.feedId,
  ownerId: feedSubscriptions.ownerId,
  feedUrl: feedCatalog.feedUrl,
  enabled: feedSubscriptions.enabled,
  createdAt: feedSubscriptions.createdAt,
}

const feedProjection = {
  feedId: feedCatalog.feedId,
  feedUrl: feedCatalog.feedUrl,
}

export const createSubscriptionRepository = (
  database: ContentKnowledgeDatabase
): Effect.Effect<SubscriptionRepository, SubscriptionStoreError> =>
  Effect.sync(() => {
    const selectSubscriptions = () =>
      database
        .select(subscriptionProjection)
        .from(feedSubscriptions)
        .innerJoin(
          feedCatalog,
          eq(feedCatalog.feedId, feedSubscriptions.feedId)
        )

    const list: SubscriptionRepository["list"] = (ownerId) =>
      Effect.try({
        try: () =>
          selectSubscriptions()
            .where(eq(feedSubscriptions.ownerId, ownerId))
            .orderBy(
              asc(feedSubscriptions.createdAt),
              asc(feedSubscriptions.subscriptionId)
            )
            .all(),
        catch: () => failure("List"),
      }).pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) => decodeSubscription(row, "List"))
        ),
        Effect.map(deepFreeze)
      )

    const add: SubscriptionRepository["add"] = (subscription) =>
      Effect.try({
        try: () =>
          database.transaction((tx) => {
            tx.insert(feedCatalog)
              .values({
                feedId: subscription.feedId,
                feedUrl: subscription.feedUrl,
                createdAt: subscription.createdAt,
              })
              .onConflictDoNothing({ target: feedCatalog.feedUrl })
              .run()

            const feed = tx
              .select({ feedId: feedCatalog.feedId })
              .from(feedCatalog)
              .where(eq(feedCatalog.feedUrl, subscription.feedUrl))
              .get()
            if (feed === undefined) throw new Error("feed catalog unavailable")

            const inserted = tx
              .insert(feedSubscriptions)
              .values({
                subscriptionId: subscription.subscriptionId,
                ownerId: subscription.ownerId,
                feedId: feed.feedId,
                createdAt: subscription.createdAt,
              })
              .onConflictDoNothing({
                target: [feedSubscriptions.ownerId, feedSubscriptions.feedId],
              })
              .run()

            const articles = tx
              .select({ articleId: feedItems.articleId })
              .from(feedItems)
              .where(eq(feedItems.feedId, feed.feedId))
              .all()
            if (articles.length > 0)
              tx.insert(articleOwnerAccess)
                .values(
                  articles.map(({ articleId }) => ({
                    ownerId: subscription.ownerId,
                    articleId,
                    acquiredAt: subscription.createdAt,
                  }))
                )
                .onConflictDoNothing()
                .run()

            const row = tx
              .select(subscriptionProjection)
              .from(feedSubscriptions)
              .innerJoin(
                feedCatalog,
                eq(feedCatalog.feedId, feedSubscriptions.feedId)
              )
              .where(
                and(
                  eq(feedSubscriptions.ownerId, subscription.ownerId),
                  eq(feedSubscriptions.feedId, feed.feedId)
                )
              )
              .get()

            return { inserted: Number(inserted.changes) === 1, row }
          }),
        catch: () => failure("Add"),
      }).pipe(
        Effect.flatMap(({ inserted, row }) =>
          decodeSubscription(row, "Add").pipe(
            Effect.map((canonical) =>
              deepFreeze({
                _tag: inserted ? ("Added" as const) : ("Existing" as const),
                subscription: canonical,
              })
            )
          )
        )
      )

    const remove: SubscriptionRepository["remove"] = (
      ownerId,
      subscriptionId
    ) =>
      Effect.try({
        try: () =>
          database
            .delete(feedSubscriptions)
            .where(
              and(
                eq(feedSubscriptions.subscriptionId, subscriptionId),
                eq(feedSubscriptions.ownerId, ownerId)
              )
            )
            .run(),
        catch: () => failure("Delete"),
      }).pipe(
        Effect.map((result) =>
          deepFreeze({
            _tag:
              Number(result.changes) === 1
                ? ("Deleted" as const)
                : ("NotFound" as const),
          })
        )
      )

    const setEnabled: SubscriptionRepository["setEnabled"] = (
      ownerId,
      subscriptionId,
      enabled
    ) =>
      Effect.try({
        try: () => {
          const updated = database
            .update(feedSubscriptions)
            .set({ enabled: enabled ? 1 : 0 })
            .where(
              and(
                eq(feedSubscriptions.subscriptionId, subscriptionId),
                eq(feedSubscriptions.ownerId, ownerId)
              )
            )
            .run()
          if (Number(updated.changes) !== 1) return undefined

          return selectSubscriptions()
            .where(
              and(
                eq(feedSubscriptions.subscriptionId, subscriptionId),
                eq(feedSubscriptions.ownerId, ownerId)
              )
            )
            .get()
        },
        catch: () => failure("Update"),
      }).pipe(
        Effect.flatMap(
          (
            row
          ): Effect.Effect<SubscriptionStateResult, SubscriptionStoreError> =>
            row === undefined
              ? Effect.succeed({ _tag: "NotFound" as const })
              : decodeSubscription(row, "Update").pipe(
                  Effect.map((subscription) =>
                    deepFreeze({
                      _tag: "Updated" as const,
                      subscription,
                      enabled,
                    })
                  )
                )
        )
      )

    const listCatalog: SubscriptionRepository["listCatalog"] = (
      _ownerId,
      query
    ) =>
      Effect.try({
        try: () =>
          database
            .select(feedProjection)
            .from(feedCatalog)
            .where(
              query === undefined
                ? undefined
                : like(
                    feedCatalog.feedUrl,
                    sql`${`%${escapeLikePattern(query)}%`} ESCAPE '\\'`
                  )
            )
            .orderBy(asc(feedCatalog.feedUrl), asc(feedCatalog.feedId))
            .limit(100)
            .all(),
        catch: () => failure("ListCatalog"),
      }).pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) =>
            parseFeedRow(row).pipe(
              Effect.flatMap((value) => parse(PollingFeedSchema)(value)),
              Effect.mapError(() => failure("ListCatalog", "CorruptRecord"))
            )
          )
        ),
        Effect.map(deepFreeze)
      )

    const listFeedsForPolling: SubscriptionRepository["listFeedsForPolling"] =
      () =>
        Effect.try({
          try: () =>
            database
              .select(feedProjection)
              .from(feedCatalog)
              .where(
                exists(
                  database
                    .select({ one: sql`1` })
                    .from(feedSubscriptions)
                    .where(
                      and(
                        eq(feedSubscriptions.feedId, feedCatalog.feedId),
                        eq(feedSubscriptions.enabled, 1)
                      )
                    )
                )
              )
              .orderBy(asc(feedCatalog.createdAt), asc(feedCatalog.feedId))
              .all(),
          catch: () => failure("ListFeeds"),
        }).pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              parseFeedRow(row).pipe(
                Effect.flatMap((value) => parse(PollingFeedSchema)(value)),
                Effect.mapError(() => failure("ListFeeds", "CorruptRecord"))
              )
            )
          ),
          Effect.map(deepFreeze)
        )

    return deepFreeze({
      add,
      list,
      remove,
      setEnabled,
      listCatalog,
      listFeedsForPolling,
    })
  })
