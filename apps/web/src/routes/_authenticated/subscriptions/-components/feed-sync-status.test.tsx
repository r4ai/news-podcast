import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { Feed, FeedSyncJob } from "@/features/subscriptions"
import { FeedSyncStatusView } from "./feed-sync-status"

const feed = {
  id: "feed-1",
  name: "Example News",
  siteUrl: "https://example.com/",
  feedUrl: "https://example.com/feed.xml",
} as Feed

const job = (status: FeedSyncJob["status"]): FeedSyncJob =>
  ({
    jobId: "job-1",
    feedId: feed.id,
    feedUrl: feed.feedUrl,
    status,
    attempt: 1,
    maxAttempts: 4,
    discovered: 3,
    archived: status === "succeeded" ? 3 : 1,
    failed: status === "failed" ? 1 : 0,
    createdAt: "2026-08-13T00:00:00.000Z",
    ...(status === "failed" ? { error: "HttpStatus" } : {}),
  }) as FeedSyncJob

describe("FeedSyncStatusView", () => {
  it("explains that queued work will appear in the article list", () => {
    render(
      <FeedSyncStatusView
        feeds={[feed]}
        isPending={false}
        jobs={[job("queued")]}
      />
    )

    expect(screen.getByText("Example News")).toBeTruthy()
    expect(screen.getByText("待機中")).toBeTruthy()
    expect(screen.getByText(/まもなく同期を開始/)).toBeTruthy()
  })

  it("shows partial failure and the next retry policy", () => {
    render(
      <FeedSyncStatusView
        feeds={[feed]}
        isPending={false}
        jobs={[job("failed")]}
      />
    )

    expect(screen.getByText("失敗")).toBeTruthy()
    expect(screen.getByText(/次回の定期同期で再試行/)).toBeTruthy()
  })
})
