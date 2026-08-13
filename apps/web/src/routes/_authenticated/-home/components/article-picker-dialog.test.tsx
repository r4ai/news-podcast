import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Article } from "@/features/articles"
import { ArticlePickerDialog } from "./article-picker-dialog"

function article(id: string, title: string): Article {
  return {
    id,
    feedId: "feed-1",
    sourceName: "Zenn",
    title,
    url: `https://example.com/${id}`,
    discoveredAt: "2026-08-12T00:00:00.000Z",
    archiveStatus: "succeeded",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
  } as Article
}

describe("ArticlePickerDialog", () => {
  it("filters candidates in the dialog without changing the selection", async () => {
    const user = userEvent.setup()
    render(
      <ArticlePickerDialog
        articles={[
          article("a", "TypeScriptのニュース"),
          article("b", "SQLiteのニュース"),
        ]}
        atLimit={false}
        onClear={vi.fn()}
        onConfirm={vi.fn()}
        onLoadMore={vi.fn()}
        onOpenChange={vi.fn()}
        onRetry={vi.fn()}
        onSelectTop={vi.fn()}
        onToggle={vi.fn()}
        open
        selected={new Set(["a"])}
        selectedCount={1}
      />
    )

    await user.type(
      screen.getByRole("searchbox", { name: "候補記事を検索" }),
      "SQLite"
    )

    expect(screen.queryByText("TypeScriptのニュース")).toBeNull()
    expect(screen.getByText("SQLiteのニュース")).toBeTruthy()
    expect(screen.getByText("1/20件を選択中")).toBeTruthy()
  })
})
