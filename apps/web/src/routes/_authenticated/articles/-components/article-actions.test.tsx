import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Article } from "../-model"
import { ArticleActions } from "./article-actions"

function makeArticle(read: boolean): Article {
  return {
    id: "article-1",
    feedId: "feed-1",
    sourceName: "Example Feed",
    title: "操作を確認する記事",
    url: "https://example.com/article-1",
    discoveredAt: "2026-08-23T00:00:00.000Z",
    archiveStatus: "succeeded",
    read,
    saved: false,
    readLater: false,
    hidden: false,
  } as Article
}

describe("ArticleActions の未読操作", () => {
  it("既読記事をポインター操作で未読へ戻せる", async () => {
    const markUnread = vi.fn()
    const user = userEvent.setup()

    render(
      <ArticleActions
        article={makeArticle(true)}
        onMarkUnread={markUnread}
        onToggleHidden={() => {}}
        onToggleReadLater={() => {}}
        onToggleSaved={() => {}}
      />
    )

    await user.click(screen.getByRole("button", { name: "未読に戻す" }))

    expect(markUnread).toHaveBeenCalledOnce()
  })

  it("すでに未読の記事では不要な操作を重複表示しない", () => {
    render(
      <ArticleActions
        article={makeArticle(false)}
        onMarkUnread={() => {}}
        onToggleHidden={() => {}}
        onToggleReadLater={() => {}}
        onToggleSaved={() => {}}
      />
    )

    expect(screen.queryByRole("button", { name: "未読に戻す" })).toBeNull()
  })
})
