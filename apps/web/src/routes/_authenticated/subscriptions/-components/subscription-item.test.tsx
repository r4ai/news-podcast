import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { FeedSyncJob, Subscription } from "@/features/subscriptions"
import { SubscriptionItem } from "./subscription-item"

const subscription = {
  id: "sub-1",
  feedId: "feed-1",
  enabled: true,
} as unknown as Subscription

function job(status: FeedSyncJob["status"]): FeedSyncJob {
  return {
    jobId: "job-1",
    feedId: "feed-1",
    feedUrl: "https://example.com/feed.xml",
    status,
    attempt: 1,
    maxAttempts: 4,
    discovered: 0,
    archived: 0,
    failed: 0,
    createdAt: "2026-08-15T00:00:00.000Z",
  } as FeedSyncJob
}

describe("SubscriptionItem", () => {
  it("syncs via the overflow menu", async () => {
    const onSync = vi.fn()
    const user = userEvent.setup()

    render(
      <SubscriptionItem
        disabled={false}
        feedName="Zenn"
        onRemove={vi.fn()}
        onSync={onSync}
        onToggle={vi.fn()}
        subscription={subscription}
      />
    )

    await user.click(screen.getByRole("button", { name: "Zennの操作" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "今すぐ同期" })
    )

    expect(onSync).toHaveBeenCalledOnce()
  })

  it("confirms before removing via the overflow menu", async () => {
    const onRemove = vi.fn()
    const user = userEvent.setup()

    render(
      <SubscriptionItem
        disabled={false}
        feedName="Zenn"
        onRemove={onRemove}
        onSync={vi.fn()}
        onToggle={vi.fn()}
        subscription={subscription}
      />
    )

    await user.click(screen.getByRole("button", { name: "Zennの操作" }))
    await user.click(await screen.findByRole("menuitem", { name: "削除" }))
    await user.click(await screen.findByRole("button", { name: "削除する" }))

    expect(onRemove).toHaveBeenCalledOnce()
  })

  it("shows syncing status and disables manual sync while a job is active", () => {
    render(
      <SubscriptionItem
        disabled={false}
        feedName="Zenn"
        job={job("processing")}
        onRemove={vi.fn()}
        onSync={vi.fn()}
        onToggle={vi.fn()}
        subscription={subscription}
      />
    )

    expect(screen.getByText("同期中…")).toBeTruthy()
  })

  it("shows a failure status when the last sync job failed", () => {
    render(
      <SubscriptionItem
        disabled={false}
        feedName="Zenn"
        job={job("failed")}
        onRemove={vi.fn()}
        onSync={vi.fn()}
        onToggle={vi.fn()}
        subscription={subscription}
      />
    )

    expect(screen.getByText("前回の同期に失敗しました")).toBeTruthy()
  })

  it("shows the isolated item failure count after a degraded success", () => {
    render(
      <SubscriptionItem
        disabled={false}
        feedName="Zenn"
        job={{ ...job("succeeded"), archived: 1, failed: 2 }}
        onRemove={vi.fn()}
        onSync={vi.fn()}
        onToggle={vi.fn()}
        subscription={subscription}
      />
    )

    expect(
      screen.getByText("前回の同期で2件の記事を取得できませんでした")
    ).toBeTruthy()
  })
})
