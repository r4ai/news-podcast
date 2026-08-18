import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TestProviders, createTestQueryClient } from "@/shared/test/render"
import { defaultArticlesSearch, type Article } from "../-model"
import { ArticleList } from "./article-list"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function makeArticle(index: number): Article {
  return {
    id: `article-${index}`,
    feedId: "feed-1",
    sourceName: "Zenn",
    title: `記事 ${index}`,
    url: `https://example.com/${index}`,
    discoveredAt: "2026-08-11T00:00:00.000Z",
    publishedAt: "2026-08-11T00:00:00.000Z",
    archiveStatus: "succeeded",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
  } as Article
}

const facets = {
  states: { all: 1, unread: 1, saved: 0, later: 0 },
  feeds: [{ feedId: "feed-1", name: "Zenn", count: 1 }],
  aiPending: 0,
}

/**
 * 一覧本体だけが未応答の状態を作る。ヘッダーが読む件数と同期ジョブは先に返す
 * ので、「行の取得を待っている間」だけを切り出して観察できる。
 */
function stubPendingArticles() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(new Request(input, init).url, "http://localhost")
      if (url.pathname === "/v1/me/articles") {
        // 解決しない。一覧の取得中に張り付いた状態を保つ。
        return new Promise<Response>(() => {})
      }
      const body =
        url.pathname === "/v1/me/articles/facets" ? facets : { items: [] }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
  )
}

function renderList() {
  return render(
    <TestProviders queryClient={createTestQueryClient()}>
      <ArticleList
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
        search={defaultArticlesSearch}
        selectedArticleId={undefined}
      />
    </TestProviders>
  )
}

describe("ArticleList の読み込み境界", () => {
  it("行の取得中もヘッダーの検索と状態タブを描き続ける", async () => {
    stubPendingArticles()
    renderList()

    // 読み込みの骨組みは行の分だけ。器(ヘッダー)まで消えると、取得のたびに
    // 検索語や絞り込みへ触れなくなる。
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "記事を読み込み中" })
      ).toBeDefined()
    )
    expect(screen.getByRole("textbox", { name: "記事を検索" })).toBeDefined()
    expect(screen.getByRole("button", { name: /未読/ })).toBeDefined()
  })

  it("行の取得中でも検索欄へ入力できる", async () => {
    stubPendingArticles()
    const user = userEvent.setup()
    renderList()

    const search = await screen.findByRole("textbox", { name: "記事を検索" })
    await user.type(search, "react")

    expect((search as HTMLInputElement).value).toBe("react")
  })

  it("骨組みは行の形を保ち、切り替わりで一覧の高さが飛ばない", async () => {
    stubPendingArticles()
    renderList()

    const skeleton = await screen.findByRole("status", {
      name: "記事を読み込み中",
    })
    expect(
      skeleton.querySelectorAll("[data-slot='skeleton']").length
    ).toBeGreaterThan(0)
  })
})

describe("ArticleList の一覧表示", () => {
  it("取得できた記事を行として並べる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(new Request(input, init).url, "http://localhost")
        const body =
          url.pathname === "/v1/me/articles"
            ? { items: [makeArticle(0)], page: { hasMore: false } }
            : url.pathname === "/v1/me/articles/facets"
              ? facets
              : { items: [] }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })
    )
    renderList()

    await waitFor(() => expect(screen.getByText("記事 0")).toBeDefined())
    expect(
      screen.queryByRole("status", { name: "記事を読み込み中" })
    ).toBeNull()
  })
})
