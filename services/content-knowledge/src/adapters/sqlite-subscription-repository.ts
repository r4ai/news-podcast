import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type {
  SubscriptionRepository,
  SubscriptionStoreError,
} from "../application/subscription-ports.js"
import {
  FeedSubscriptionSchema,
  PollingFeedSchema,
} from "../domain/subscription.js"
import type { SqlitePort } from "./sqlite-port.js"

const schema = `
CREATE TABLE IF NOT EXISTS feed_catalog (
  feed_id TEXT PRIMARY KEY,
  feed_url TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS feed_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  feed_id TEXT NOT NULL REFERENCES feed_catalog(feed_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, feed_id)
) STRICT;
CREATE INDEX IF NOT EXISTS feed_subscriptions_owner
  ON feed_subscriptions(owner_id, created_at, subscription_id);
`

const SubscriptionRowSchema = Schema.Struct({
  subscriptionId: Schema.String,
  feedId: Schema.String,
  ownerId: Schema.String,
  feedUrl: Schema.String,
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
    Effect.flatMap((value) => parse(FeedSubscriptionSchema)(value)),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const createSqliteSubscriptionRepository = (
  database: SqlitePort
): Effect.Effect<SubscriptionRepository, SubscriptionStoreError> =>
  Effect.try({
    try: () => database.execute(schema),
    catch: () => failure("Add"),
  }).pipe(
    Effect.map(() => {
      const list: SubscriptionRepository["list"] = (ownerId) =>
        Effect.try({
          try: () =>
            database.all(
              `SELECT s.subscription_id AS subscriptionId,
                    s.feed_id AS feedId,
                    s.owner_id AS ownerId,
                    f.feed_url AS feedUrl,
                    s.created_at AS createdAt
               FROM feed_subscriptions s
               JOIN feed_catalog f ON f.feed_id = s.feed_id
              WHERE s.owner_id = ?
              ORDER BY s.created_at, s.subscription_id`,
              [ownerId]
            ),
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
            database.transaction(() => {
              database.run(
                `INSERT INTO feed_catalog(feed_id, feed_url, created_at)
               VALUES (?, ?, ?)
               ON CONFLICT(feed_url) DO NOTHING`,
                [
                  subscription.feedId,
                  subscription.feedUrl,
                  subscription.createdAt,
                ]
              )
              const feed = database.get(
                "SELECT feed_id AS feedId FROM feed_catalog WHERE feed_url = ?",
                [subscription.feedUrl]
              ) as { readonly feedId: string } | undefined
              if (feed === undefined)
                throw new Error("feed catalog unavailable")
              const inserted = database.run(
                `INSERT INTO feed_subscriptions(subscription_id, owner_id, feed_id, created_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(owner_id, feed_id) DO NOTHING`,
                [
                  subscription.subscriptionId,
                  subscription.ownerId,
                  feed.feedId,
                  subscription.createdAt,
                ]
              )
              const row = database.get(
                `SELECT s.subscription_id AS subscriptionId,
                      s.feed_id AS feedId,
                      s.owner_id AS ownerId,
                      f.feed_url AS feedUrl,
                      s.created_at AS createdAt
                 FROM feed_subscriptions s
                 JOIN feed_catalog f ON f.feed_id = s.feed_id
                WHERE s.owner_id = ? AND s.feed_id = ?`,
                [subscription.ownerId, feed.feedId]
              )
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
            database.run(
              "DELETE FROM feed_subscriptions WHERE subscription_id = ? AND owner_id = ?",
              [subscriptionId, ownerId]
            ),
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

      const listFeedsForPolling: SubscriptionRepository["listFeedsForPolling"] =
        () =>
          Effect.try({
            try: () =>
              database.all(
                `SELECT f.feed_id AS feedId, f.feed_url AS feedUrl
               FROM feed_catalog f
              WHERE EXISTS (SELECT 1 FROM feed_subscriptions s WHERE s.feed_id = f.feed_id)
              ORDER BY f.created_at, f.feed_id`
              ),
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

      return deepFreeze({ add, list, remove, listFeedsForPolling })
    })
  )
