import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  CreatedAtSchema,
  FeedIdSchema,
  FeedUrlSchema,
  OwnerIdSchema,
  SubscriptionIdSchema,
} from "../domain/subscription.js"
import { openTestDatabase } from "./persistence/testing.js"
import { createSubscriptionRepository } from "./persistence/subscription/repository.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
) => Schema.decodeUnknownSync(schema)(value)
const ownerA = decode(OwnerIdSchema, "owner-a")
const ownerB = decode(OwnerIdSchema, "owner-b")
const feedUrl = decode(
  FeedUrlSchema,
  "https://feeds.example.com/private/news.xml?token=owner-a-secret"
)
const createdAt = decode(CreatedAtSchema, "2026-08-13T01:00:00.000Z")

describe("SQLite subscription repository", () => {
  it("deduplicates a feed only after each owner submits the same URL", async () => {
    const database = openTestDatabase()
    try {
      const repository = await Effect.runPromise(
        createSubscriptionRepository(database.db)
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
      const secondOwner = await Effect.runPromise(
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
      expect(await Effect.runPromise(repository.listCatalog(ownerB))).toEqual([
        {
          feedId: secondOwner.subscription.feedId,
          feedUrl: secondOwner.subscription.feedUrl,
        },
      ])
      expect(await Effect.runPromise(repository.listFeedsForPolling())).toEqual(
        [{ feedId: first.subscription.feedId, feedUrl }]
      )
    } finally {
      database.close()
    }
  })

  it("lets an owner subscribe again after deleting the canonical subscription", async () => {
    const database = openTestDatabase()
    try {
      const repository = await Effect.runPromise(
        createSubscriptionRepository(database.db)
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
      await Effect.runPromise(
        repository.remove(ownerA, first.subscription.subscriptionId)
      )

      const second = await Effect.runPromise(
        repository.add({
          subscriptionId: decode(
            SubscriptionIdSchema,
            "12953489-2b83-4d01-a737-25ea7b9f952a"
          ),
          feedId: decode(FeedIdSchema, "dfe96b69-11c9-4c11-93da-aca33ab74457"),
          ownerId: ownerA,
          feedUrl,
          createdAt: decode(CreatedAtSchema, "2026-08-13T02:00:00.000Z"),
        })
      )

      expect(second).toMatchObject({
        _tag: "Added",
        subscription: { feedId: first.subscription.feedId, feedUrl },
      })
    } finally {
      database.close()
    }
  })

  it("cannot delete another owner's subscription", async () => {
    const database = openTestDatabase()
    try {
      const repository = await Effect.runPromise(
        createSubscriptionRepository(database.db)
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

  it("keeps an arbitrary private feed out of another owner's catalog", async () => {
    const database = openTestDatabase()
    try {
      const repository = await Effect.runPromise(
        createSubscriptionRepository(database.db)
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
          repository.setEnabled(
            ownerB,
            added.subscription.subscriptionId,
            false
          )
        )
      ).toEqual({ _tag: "NotFound" })
      expect(
        await Effect.runPromise(
          repository.setEnabled(
            ownerA,
            added.subscription.subscriptionId,
            false
          )
        )
      ).toMatchObject({ _tag: "Updated", enabled: false })
      expect(await Effect.runPromise(repository.listFeedsForPolling())).toEqual(
        []
      )
      const pathSecretUrl = decode(
        FeedUrlSchema,
        "https://feeds.example.com/access/owner-a-path-secret/feed.xml"
      )
      await Effect.runPromise(
        repository.add({
          subscriptionId: decode(
            SubscriptionIdSchema,
            "5d31cf0f-d2b1-45e1-a0cc-bc6668c8348a"
          ),
          feedId: decode(FeedIdSchema, "2eb4dd58-6360-434c-948c-56c7f9a06156"),
          ownerId: ownerA,
          feedUrl: pathSecretUrl,
          createdAt,
        })
      )
      expect(
        await Effect.runPromise(
          repository.listCatalog(ownerA, "owner-a-secret")
        )
      ).toEqual([{ feedId: added.subscription.feedId, feedUrl }])
      expect(await Effect.runPromise(repository.listCatalog(ownerB))).toEqual(
        []
      )
      expect(
        await Effect.runPromise(
          repository.listCatalog(ownerB, "owner-a-secret")
        )
      ).toEqual([])
      expect(
        await Effect.runPromise(
          repository.listCatalog(ownerB, "owner-a-path-secret")
        )
      ).toEqual([])

      const publicFeedUrl = decode(
        FeedUrlSchema,
        "https://public.example.com/news.xml"
      )
      const publicFeed = await Effect.runPromise(
        repository.add({
          subscriptionId: decode(
            SubscriptionIdSchema,
            "db7f9d6f-7ee6-49a3-89ba-b4d6372bc699"
          ),
          feedId: decode(FeedIdSchema, "36970161-064f-45ab-8dcb-101675d75274"),
          ownerId: ownerA,
          feedUrl: publicFeedUrl,
          createdAt,
        })
      )
      database.runSql(
        "INSERT INTO public_feed_listings (feed_id, listed_at) VALUES (?, ?)",
        [publicFeed.subscription.feedId, createdAt]
      )
      expect(await Effect.runPromise(repository.listCatalog(ownerB))).toEqual([
        { feedId: publicFeed.subscription.feedId, feedUrl: publicFeedUrl },
      ])
      database.runSql("DELETE FROM public_feed_listings WHERE feed_id = ?", [
        publicFeed.subscription.feedId,
      ])
      expect(await Effect.runPromise(repository.listCatalog(ownerB))).toEqual(
        []
      )
    } finally {
      database.close()
    }
  })
})
