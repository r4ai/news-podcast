import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  CreatedAtSchema,
  FeedIdSchema,
  FeedUrlSchema,
  OwnerIdSchema,
  SubscriptionIdSchema,
} from "../domain/subscription.js"
import { openSqliteUnsafe } from "../infrastructure/unsafe/sqlite.js"
import { createSqliteSubscriptionRepository } from "./sqlite-subscription-repository.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)
const ownerA = decode(OwnerIdSchema, "owner-a")
const ownerB = decode(OwnerIdSchema, "owner-b")
const feedUrl = decode(FeedUrlSchema, "https://feeds.example.com/news.xml")
const createdAt = decode(CreatedAtSchema, "2026-08-13T01:00:00.000Z")

describe("SQLite subscription repository", () => {
  it("adds idempotently, lists by owner, and shares the feed catalog", async () => {
    const database = openSqliteUnsafe(":memory:")
    try {
      const repository = await Effect.runPromise(
        createSqliteSubscriptionRepository(database)
      )
      const first = await Effect.runPromise(
        repository.add({
          subscriptionId: decode(
            SubscriptionIdSchema,
            "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
          ),
          feedId: decode(FeedIdSchema, "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"),
          ownerId: ownerA,
          feedUrl,
          createdAt,
        })
      )
      const retried = await Effect.runPromise(
        repository.add({
          subscriptionId: decode(
            SubscriptionIdSchema,
            "00508c91-8d8a-452f-82d3-fc621faea801"
          ),
          feedId: decode(FeedIdSchema, "7f196ffe-e660-4701-ad10-cdce1054213b"),
          ownerId: ownerA,
          feedUrl,
          createdAt,
        })
      )
      await Effect.runPromise(
        repository.add({
          subscriptionId: decode(
            SubscriptionIdSchema,
            "c372f4e6-40c5-48be-be7d-d22811801895"
          ),
          feedId: decode(FeedIdSchema, "02f2949b-102b-4121-8868-347cdf01e930"),
          ownerId: ownerB,
          feedUrl,
          createdAt,
        })
      )

      expect(retried).toEqual({
        _tag: "Existing",
        subscription: first.subscription,
      })
      expect(await Effect.runPromise(repository.list(ownerA))).toEqual([
        first.subscription,
      ])
      expect(await Effect.runPromise(repository.listFeedsForPolling())).toEqual(
        [{ feedId: first.subscription.feedId, feedUrl }]
      )
    } finally {
      database.close()
    }
  })

  it("cannot delete another owner's subscription", async () => {
    const database = openSqliteUnsafe(":memory:")
    try {
      const repository = await Effect.runPromise(
        createSqliteSubscriptionRepository(database)
      )
      const added = await Effect.runPromise(
        repository.add({
          subscriptionId: decode(
            SubscriptionIdSchema,
            "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
          ),
          feedId: decode(FeedIdSchema, "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"),
          ownerId: ownerA,
          feedUrl,
          createdAt,
        })
      )

      expect(
        await Effect.runPromise(
          repository.remove(ownerB, added.subscription.subscriptionId)
        )
      ).toEqual({ _tag: "NotFound" })
      expect(
        await Effect.runPromise(
          repository.remove(ownerA, added.subscription.subscriptionId)
        )
      ).toEqual({ _tag: "Deleted" })
    } finally {
      database.close()
    }
  })
})
