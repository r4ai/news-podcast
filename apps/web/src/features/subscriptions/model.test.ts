import { describe, expect, it } from "vitest"

import { enabledFeedNames, feedNameResolver } from "./model"
import type { Feed, Subscription } from "./model"

const feeds = [
  { id: "feed-1", name: "Zenn" },
  { id: "feed-2", name: "Hacker News" },
] as unknown as Feed[]

const subscriptions = [
  { id: "sub-1", feedId: "feed-1", enabled: true },
  { id: "sub-2", feedId: "feed-2", enabled: false },
  { id: "sub-3", feedId: "feed-missing", enabled: true },
] as unknown as Subscription[]

describe("subscription display model", () => {
  it("falls back to the feed id when the catalog has no matching feed", () => {
    const nameOf = feedNameResolver(feeds)
    expect(nameOf("feed-1")).toBe("Zenn")
    expect(nameOf("feed-missing")).toBe("feed-missing")
  })

  it("lists only the feeds that will be included in the next episode", () => {
    expect(enabledFeedNames(subscriptions, feeds)).toEqual([
      "Zenn",
      "feed-missing",
    ])
  })

  it("sorts feed names deterministically instead of preserving API order", () => {
    expect(
      enabledFeedNames(
        [
          { id: "sub-2", feedId: "feed-2", enabled: true },
          { id: "sub-1", feedId: "feed-1", enabled: true },
        ] as unknown as Subscription[],
        feeds
      )
    ).toEqual(["Hacker News", "Zenn"])
  })
})
