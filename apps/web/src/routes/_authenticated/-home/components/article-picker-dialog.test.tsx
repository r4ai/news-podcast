import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
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

function SearchHarness() {
  const [searchQuery, setSearchQuery] = useState("")
  return (
    <ArticlePickerDialog
      articles={[
        article("a", "TypeScriptのニュース"),
        article("b", "SQLiteのニュース"),
      ]}
      atLimit={false}
      hasSearchQuery={searchQuery !== ""}
      onClear={vi.fn()}
      onConfirm={vi.fn()}
      onLoadMore={vi.fn()}
      onOpenChange={vi.fn()}
      onRetry={vi.fn()}
      onSearchChange={setSearchQuery}
      onSelectTop={vi.fn()}
      onToggle={vi.fn()}
      open
      searchQuery={searchQuery}
      selected={new Set(["a"])}
      selectedCount={1}
    />
  )
}

describe("ArticlePickerDialog", () => {
  it("keeps search input urgent while server results stay visible", async () => {
    const user = userEvent.setup()
    render(<SearchHarness />)

    await user.type(
      screen.getByRole("searchbox", { name: "候補記事を検索" }),
      "SQLite"
    )

    expect(
      (
        screen.getByRole("searchbox", {
          name: "候補記事を検索",
        }) as HTMLInputElement
      ).value
    ).toBe("SQLite")
    expect(screen.getByText("TypeScriptのニュース")).toBeTruthy()
    expect(screen.getByText("SQLiteのニュース")).toBeTruthy()
    expect(screen.getByText("1/20件を選択中")).toBeTruthy()
  })

  it("distinguishes a pending search from an empty result", () => {
    const common = {
      atLimit: false,
      onClear: vi.fn(),
      onConfirm: vi.fn(),
      onLoadMore: vi.fn(),
      onOpenChange: vi.fn(),
      onRetry: vi.fn(),
      onSearchChange: vi.fn(),
      onSelectTop: vi.fn(),
      onToggle: vi.fn(),
      open: true,
      searchQuery: "observability",
      selected: new Set<string>(),
      selectedCount: 0,
    } as const
    const { rerender } = render(
      <ArticlePickerDialog
        {...common}
        articles={[article("a", "TypeScriptのニュース")]}
        hasSearchQuery
        isSearching
      />
    )

    expect(screen.getByText("検索中…")).toBeTruthy()
    expect(screen.getByText("TypeScriptのニュース")).toBeTruthy()

    rerender(
      <ArticlePickerDialog
        {...common}
        articles={[]}
        hasSearchQuery
        isSearching={false}
      />
    )
    expect(screen.getByText("検索に一致する記事がありません")).toBeTruthy()
  })
})
