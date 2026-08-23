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
  it("explains that pausing excludes new sync and AI processing", () => {
    render(
      <SubscriptionItem
        disabled={false}
        feedName="Zenn"
        onRemove={vi.fn()}
        onSync={vi.fn()}
        onToggle={vi.fn()}
        subscription={{ ...subscription, enabled: false }}
      />
    )

    expect(
      screen.getByText("一時停止中（新着取得・AI処理の対象外）")
    ).toBeTruthy()
    expect(
      screen.getByRole("switch", { name: "Zennの同期・生成を有効にする" })
    ).toBeTruthy()
  })

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
    expect(
      await screen.findByText(
        "Zennは次回以降の同期と番組へ含まれなくなります。保存済みの記事と過去のエピソードの出典は残ります。"
      )
    ).toBeTruthy()
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

  it.each([
    ["Unavailable", "取得先へ接続できません"],
    ["Timeout", "取得先へ接続できません"],
    ["HttpStatus", "取得先へ接続できません"],
    ["MalformedResponse", "RSS/Atom形式ではありません"],
  ])("explains a %s synchronization failure", (error, message) => {
    render(
      <SubscriptionItem
        disabled={false}
        feedName="Zenn"
        job={{ ...job("failed"), error }}
        onRemove={vi.fn()}
        onSync={vi.fn()}
        onToggle={vi.fn()}
        subscription={subscription}
      />
    )

    expect(screen.getByText(new RegExp(message))).toBeTruthy()
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

  it("shows a sanitized invalid-item reason after a degraded sync", () => {
    render(
      <SubscriptionItem
        disabled={false}
        feedName="Zenn"
        job={{
          ...job("succeeded"),
          failed: 1,
          error: "MissingLink",
        }}
        onRemove={vi.fn()}
        onSync={vi.fn()}
        onToggle={vi.fn()}
        subscription={subscription}
      />
    )

    expect(
      screen.getByText(
        "前回の同期で1件の記事を取得できませんでした（理由: リンク欠落）"
      )
    ).toBeTruthy()
  })
})
