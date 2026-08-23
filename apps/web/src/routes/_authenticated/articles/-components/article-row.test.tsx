import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { Article } from "../-model"
import { ArticleRow } from "./article-row"

function makeArticle(read: boolean): Article {
  return {
    id: read ? "read-article" : "unread-article",
    feedId: "feed-1",
    sourceName: "Example Feed",
    title: "状態を確認する記事",
    url: "https://example.com/article",
    discoveredAt: "2026-08-23T00:00:00.000Z",
    archiveStatus: "succeeded",
    read,
    saved: false,
    readLater: false,
    hidden: false,
  } as Article
}

function renderRow(read: boolean) {
  return render(
    <ul>
      <ArticleRow
        article={makeArticle(read)}
        isSelected={false}
        onSelect={() => {}}
        onToggleSaved={() => {}}
      />
    </ul>
  )
}

describe("ArticleRow の既読状態", () => {
  it.each([
    { read: false, state: "未読", title: "状態を確認する記事" },
    { read: true, state: "既読", title: "状態を確認する記事" },
  ])(
    "$stateを文字とaccessible descriptionで一度だけ伝える",
    ({ read, state, title }) => {
      const { container } = renderRow(read)

      const rowButton = screen.getByRole("button", {
        name: new RegExp(`^${title}`),
      })
      expect(rowButton).toBeDefined()
      expect(rowButton.textContent).not.toContain(state)

      const descriptionId = rowButton.getAttribute("aria-describedby")
      expect(descriptionId).not.toBeNull()
      expect(document.getElementById(descriptionId!)?.textContent).toBe(state)

      const visibleState = container.querySelector(
        '[data-slot="article-read-state"]'
      )
      expect(visibleState?.textContent).toBe(state)
      expect(visibleState?.getAttribute("aria-hidden")).toBe("true")
    }
  )
})
