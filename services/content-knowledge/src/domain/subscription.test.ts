import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  FeedSubscriptionSchema,
  FeedUrlSchema,
  OwnerIdSchema,
} from "./subscription.js"

describe("feed subscription domain", () => {
  it("accepts an opaque owner and a canonical HTTP feed URL", () => {
    const subscription = Schema.decodeUnknownSync(FeedSubscriptionSchema)({
      subscriptionId: "9aa2225d-07e7-4af4-a8e6-e4788f801a91",
      feedId: "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd",
      ownerId: "auth0|subject-1",
      feedUrl: "https://feeds.example.com/news.xml",
      enabled: true,
      createdAt: "2026-08-13T01:00:00.000Z",
    })

    expect(subscription.ownerId).toBe("auth0|subject-1")
  })

  it.each([
    [OwnerIdSchema, "owner with spaces"],
    [FeedUrlSchema, "file:///etc/passwd"],
    [FeedUrlSchema, "https://user:secret@example.com/feed"],
    [FeedUrlSchema, "https://example.com/feed#fragment"],
    [FeedUrlSchema, "https://example.com/feed#"],
    [FeedUrlSchema, "https://EXAMPLE.com/feed"],
  ])("rejects a non-canonical or unsafe value", (schema, input) => {
    expect(() => Schema.decodeUnknownSync(schema)(input)).toThrow()
  })
})
