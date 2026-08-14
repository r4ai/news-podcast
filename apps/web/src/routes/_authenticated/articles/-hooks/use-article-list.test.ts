import { act, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import {
  defaultArticlesSearch,
  type Article,
  type ArticlesSearch,
} from "../-model"
import { applyDraft, useArticleList } from "./use-article-list"

vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function makeArticle(overrides: Partial<Article>): Article {
  return {
    id: "a",
    feedId: "feed-1",
    sourceName: "Zenn",
    title: "React 19",
    url: "https://example.com/a",
    discoveredAt: "2026-08-11T00:00:00.000Z",
    publishedAt: "2026-08-11T00:00:00.000Z",
    archiveStatus: "succeeded",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    ...overrides,
  } as Article
}

const items = [
  makeArticle({ id: "a", title: "React 19", sourceName: "Zenn", saved: false }),
  makeArticle({ id: "b", title: "OTel", sourceName: "HN", saved: true }),
]
const facets = {
  states: { all: 2, unread: 2, saved: 1, later: 0 },
  feeds: [{ feedId: "feed-1", name: "Zenn", count: 2 }],
  aiPending: 3,
}

describe("applyDraft", () => {
  it("merges the patch into the targeted article only", () => {
    const next = applyDraft(items, { id: "a", patch: { saved: true } })
    expect(next[0]?.saved).toBe(true)
    expect(next[1]).toBe(items[1])
  })
})

describe("useArticleList", () => {
  function renderList(
    routes: Parameters<typeof stubFetch>[0],
    search: ArticlesSearch = defaultArticlesSearch
  ) {
    const stub = stubFetch(routes)
    const onSearchChange = vi.fn()
    const rendered = renderHookWithProviders(
      ({ search: currentSearch }: { search: ArticlesSearch }) =>
        useArticleList({ search: currentSearch, onSearchChange }),
      { initialProps: { search } }
    )
    return { ...rendered, ...stub, onSearchChange }
  }

  it("sends state/sort/q from the URL search as query params, and exposes facet counts", async () => {
    const { result, calls } = renderList([
      { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
      { path: "/v1/me/articles/facets", body: facets },
    ])

    await waitFor(() => expect(result.current.articles).toHaveLength(2))
    expect(result.current.facets).toEqual(facets)
    expect(result.current.aiPending).toBe(3)

    const listCall = calls.find((call) => call.url === "/v1/me/articles")
    expect(listCall?.method).toBe("GET")
  })

  it("debounces search input and pushes it to the URL via onSearchChange", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result, onSearchChange } = renderList([
      {
        path: "/v1/me/articles",
        body: { items: [], page: { hasMore: false } },
      },
      { path: "/v1/me/articles/facets", body: facets },
    ])

    act(() => result.current.setQ("otel"))
    expect(onSearchChange).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(onSearchChange).toHaveBeenCalledWith(
      { q: "otel" },
      { replace: true }
    )
    vi.useRealTimers()
  })

  it("reflects a search prop change coming from browser back/forward (URL round trip)", async () => {
    const { result, rerender } = renderList(
      [
        { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
        { path: "/v1/me/articles/facets", body: facets },
      ],
      { ...defaultArticlesSearch, state: "unread" }
    )
    await waitFor(() => expect(result.current.articles).toHaveLength(2))

    rerender({ search: { ...defaultArticlesSearch, state: "saved" } })

    await waitFor(() => expect(result.current.search.state).toBe("saved"))
    expect(result.current.q).toBe(defaultArticlesSearch.q)
  })

  it("sends only the changed flag when saving an article, optimistically first", async () => {
    const { result, calls } = renderList([
      { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
      { path: "/v1/me/articles/facets", body: facets },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: { ...items[0], saved: true },
      },
    ])
    await waitFor(() => expect(result.current.articles).toHaveLength(2))

    await act(async () => result.current.toggleSaved(items[0]!))

    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual({ saved: true })
  })

  it("rolls back the optimistic update and toasts when the save mutation fails", async () => {
    const { toast } = await import("@workspace/ui/components/sonner")
    const { result } = renderList([
      { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
      { path: "/v1/me/articles/facets", body: facets },
      { method: "PATCH", path: "/v1/me/articles/a", status: 500 },
    ])
    await waitFor(() => expect(result.current.articles).toHaveLength(2))

    await act(async () => result.current.toggleSaved(items[0]!))

    expect(toast.error).toHaveBeenCalledWith("記事の状態を更新できませんでした")
    await waitFor(() =>
      expect(
        result.current.articles.find((article) => article.id === "a")?.saved
      ).toBe(false)
    )
  })

  it("marks an article read when its link is opened", async () => {
    const { result, calls } = renderList([
      { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
      { path: "/v1/me/articles/facets", body: facets },
      {
        method: "PATCH",
        path: "/v1/me/articles/b",
        body: { ...items[1], read: true },
      },
    ])
    await waitFor(() => expect(result.current.articles).toHaveLength(2))

    await act(async () => result.current.markRead(items[1]!))

    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      read: true,
    })
  })

  it("does not advertise pagination when the server reports the final page", async () => {
    const { result } = renderList([
      {
        path: "/v1/me/articles",
        body: {
          items: [items[0]],
          page: { hasMore: false },
        },
      },
      { path: "/v1/me/articles/facets", body: facets },
    ])
    await waitFor(() => expect(result.current.articles).toHaveLength(1))
    expect(result.current.hasNextPage).toBe(false)
  })

  it("continues from the server cursor and appends the next page once", async () => {
    const { result, calls } = renderList([
      {
        path: "/v1/me/articles",
        query: { cursor: undefined },
        body: {
          items: [items[0]],
          page: { hasMore: true, nextCursor: "cursor-2" },
        },
      },
      {
        path: "/v1/me/articles",
        query: { cursor: "cursor-2" },
        body: { items: [items[1]], page: { hasMore: false } },
      },
      { path: "/v1/me/articles/facets", body: facets },
    ])
    await waitFor(() => expect(result.current.articles).toHaveLength(1))
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => result.current.fetchNextPage())

    await waitFor(() => expect(result.current.articles).toHaveLength(2))
    expect(result.current.articles.map((article) => article.id)).toEqual([
      "a",
      "b",
    ])
    expect(result.current.hasNextPage).toBe(false)
    // 先頭ページはcursorを送らない。空文字や既定値が漏れると契約検証で落ちる。
    const listCalls = calls.filter((call) => call.url === "/v1/me/articles")
    expect(listCalls.map((call) => call.search.get("cursor"))).toEqual([
      null,
      "cursor-2",
    ])
  })

  it("settles a save from the response alone, without refetching the list", async () => {
    const { result, calls } = renderList([
      { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
      { path: "/v1/me/articles/facets", body: facets },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: { ...items[0], saved: true },
      },
    ])
    await waitFor(() => expect(result.current.articles).toHaveLength(2))
    const before = calls.filter((call) => call.method === "GET").length

    await act(async () => result.current.toggleSaved(items[0]!))

    await waitFor(() =>
      expect(
        result.current.articles.find((article) => article.id === "a")?.saved
      ).toBe(true)
    )
    expect(calls.filter((call) => call.method === "GET").length).toBe(before)
    // facetsの保存件数は再取得ではなく差分で進む。
    expect(result.current.facets?.states.saved).toBe(facets.states.saved + 1)
  })

  // 直列化そのものは shared/lib/action-queue.test.ts で検証している。
  // ここでは連打が「投入順のまま、1クリック1リクエスト」で流れることを見る。
  it("sends one request per rapid toggle, in submission order", async () => {
    const { result, calls } = renderList([
      { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
      { path: "/v1/me/articles/facets", body: facets },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: { ...items[0], saved: true },
      },
    ])
    await waitFor(() => expect(result.current.articles).toHaveLength(2))

    await act(async () => {
      result.current.toggleSaved(items[0]!)
      result.current.toggleSaved({ ...items[0]!, saved: true })
      result.current.toggleSaved(items[0]!)
    })

    await waitFor(() =>
      expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(3)
    )
    expect(
      calls.filter((call) => call.method === "PATCH").map((call) => call.body)
    ).toEqual([{ saved: true }, { saved: false }, { saved: true }])
  })

  it("applies a bulk read across the current filter and reports how many changed", async () => {
    const { toast } = await import("@workspace/ui/components/sonner")
    const { result, calls } = renderList([
      { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
      { path: "/v1/me/articles/facets", body: facets },
      {
        method: "POST",
        path: "/v1/me/articles/bulk-state",
        body: { updated: 2 },
      },
    ])
    await waitFor(() => expect(result.current.articles).toHaveLength(2))

    await act(async () => result.current.markAllRead())

    const bulkCall = calls.find((call) => call.method === "POST")
    expect(bulkCall?.body).toMatchObject({ read: true })
    expect(toast.success).toHaveBeenCalledWith("2件を既読にしました")
  })
})
