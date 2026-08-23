import { describe, expect, it, vi } from "vitest"

import { makeArticleSearchIndexObserver } from "./article-search-index-observability.js"

describe("article search index observability", () => {
  it("records outcomes without body, object key, or snapshot identifiers", () => {
    const count = vi.fn()
    const gauge = vi.fn()
    const log = vi.fn()
    const observer = makeArticleSearchIndexObserver({ count, gauge, log })

    observer.indexed({ snapshotId: "private-snapshot" })
    observer.failed({
      snapshotId: "private-snapshot",
      reason: "Unavailable",
      attempt: 2,
    })
    observer.backlog({ depth: 7 })

    expect(count).toHaveBeenCalledTimes(2)
    expect(gauge).toHaveBeenCalledWith("article.search_body.queue.depth", 7)
    expect(log).toHaveBeenCalledWith({
      name: "article.search_body.index_failed",
      level: "warn",
      attributes: { reason: "Unavailable", attempt: 2 },
    })
    expect(
      JSON.stringify({ count: count.mock.calls, log: log.mock.calls })
    ).not.toContain("private-snapshot")
  })
})
