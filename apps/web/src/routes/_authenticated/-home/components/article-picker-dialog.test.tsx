import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import type { Article } from "@/features/articles"
import { renderWithStubRouter } from "@/shared/test/render"
import {
  ArticlePickerDialog,
  type ArticlePickerDialogProps,
} from "./article-picker-dialog"

function emptyProps(
  overrides: Partial<ArticlePickerDialogProps> = {}
): ArticlePickerDialogProps {
  return {
    articles: [],
    atLimit: false,
    hasSearchQuery: false,
    open: true,
    searchQuery: "",
    selected: new Set(),
    selectedCount: 0,
    onClear: vi.fn(),
    onConfirm: vi.fn(),
    onLoadMore: vi.fn(),
    onOpenChange: vi.fn(),
    onRetry: vi.fn(),
    onSearchChange: vi.fn(),
    onSelectTop: vi.fn(),
    onToggle: vi.fn(),
    ...overrides,
  }
}

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
  it.each([
    ["paused", "購読が一時停止中です", "購読を再開"],
    ["syncing", "記事を取り込み中です", "同期状況を確認"],
    ["sync-failed", "記事の取り込みに失敗しました", "購読を管理・再同期"],
    ["empty", "選べる記事がまだありません", "購読を管理"],
  ] as const)(
    "offers the next action for %s",
    async (emptyState, title, action) => {
      renderWithStubRouter(
        <ArticlePickerDialog {...emptyProps({ emptyState })} />
      )
      expect(await screen.findByText(title)).toBeTruthy()
      expect(
        screen.getByRole("link", { name: action }).getAttribute("href")
      ).toBe("/subscriptions")
      expect(
        screen
          .getByRole("button", { name: "この記事で生成" })
          .hasAttribute("disabled")
      ).toBe(true)
    }
  )

  it("retries unknown source state without claiming subscriptions are empty", async () => {
    const props = emptyProps({ emptyState: "source-error" })
    render(<ArticlePickerDialog {...props} />)
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "再確認" }))
    expect(props.onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByText("RSSフィードを追加しましょう")).toBeNull()
  })

  it("clears an empty search instead of sending the owner to subscriptions", async () => {
    const props = emptyProps({
      hasSearchQuery: true,
      searchQuery: "none",
      emptyState: "no-subscriptions",
    })
    render(<ArticlePickerDialog {...props} />)
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "検索語をクリア" }))
    expect(props.onSearchChange).toHaveBeenCalledWith("")
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("can continue past a page with no archived candidates", async () => {
    const props = emptyProps({
      hasNextPage: true,
      emptyState: "no-subscriptions",
    })
    render(<ArticlePickerDialog {...props} />)
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "もっと読み込む" }))
    expect(props.onLoadMore).toHaveBeenCalledOnce()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("keeps saved candidates selectable without any subscription", async () => {
    const props = emptyProps({
      articles: [article("saved", "保存済みの記事")],
      emptyState: "no-subscriptions",
    })
    render(<ArticlePickerDialog {...props} />)
    await userEvent.setup().click(screen.getByRole("checkbox"))
    expect(props.onToggle).toHaveBeenCalledWith("saved")
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("does not show a settled empty state during an in-flight search", () => {
    render(
      <ArticlePickerDialog
        {...emptyProps({ hasSearchQuery: true, isSearching: true })}
      />
    )
    expect(screen.getByText("検索中…")).toBeTruthy()
    expect(screen.queryByText("検索に一致する記事がありません")).toBeNull()
  })

  it("takes an owner with no sources directly to subscriptions", async () => {
    const { router } = renderWithStubRouter(
      <ArticlePickerDialog
        articles={[]}
        emptyState="no-subscriptions"
        atLimit={false}
        hasSearchQuery={false}
        onClear={vi.fn()}
        onConfirm={vi.fn()}
        onLoadMore={vi.fn()}
        onOpenChange={vi.fn()}
        onRetry={vi.fn()}
        onSearchChange={vi.fn()}
        onSelectTop={vi.fn()}
        onToggle={vi.fn()}
        open
        searchQuery=""
        selected={new Set()}
        selectedCount={0}
      />
    )
    const link = await screen.findByRole("link", { name: "RSSフィードを追加" })
    expect(link.getAttribute("href")).toBe("/subscriptions")
    expect(screen.queryByText(/少し待って/)).toBeNull()
    await userEvent.setup().click(link)
    expect(router.state.location.pathname).toBe("/subscriptions")
  })

  it("describes the chronological list and its bulk selection honestly", () => {
    render(<SearchHarness />)

    expect(screen.getByText(/新着順に並んでいます/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "上から一括選択" })).toBeTruthy()
    expect(screen.queryByText(/おすすめ/)).toBeNull()
  })

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
