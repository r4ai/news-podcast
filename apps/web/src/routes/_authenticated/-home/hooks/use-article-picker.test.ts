import { act, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { renderHookWithProviders, stubFetch } from "@/shared/test/render"

import { MAX_SELECTED_ARTICLES } from "../model"
import { useArticlePicker } from "./use-article-picker"

function article(id: string) {
  return {
    id,
    feedId: "feed-1",
    sourceName: "Zenn",
    title: `記事 ${id}`,
    url: `https://zenn.dev/${id}`,
    discoveredAt: "2026-08-11T00:00:00.000Z",
    archiveStatus: "succeeded",
    read: false,
    saved: false,
    readLater: false,
    hidden: false,
    usedInEpisode: false,
    tags: [],
  }
}

function stubArticles(count: number) {
  return stubFetch([
    {
      path: "/v1/me/articles",
      body: {
        items: Array.from({ length: count }, (_, index) =>
          article(`a${index}`)
        ),
        page: { hasMore: false },
      },
    },
  ])
}

describe("useArticlePicker", () => {
  it("does not fetch candidates until the dialog opens", async () => {
    const { calls } = stubArticles(3)
    const { result } = renderHookWithProviders(() => useArticlePicker(false))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(calls).toHaveLength(0)
  })

  it("requests only archived articles in recommended order", async () => {
    const { calls } = stubArticles(3)
    const { result } = renderHookWithProviders(() => useArticlePicker(true))

    await waitFor(() => expect(result.current.articles).toHaveLength(3))
    // エージェントが読めるのはアーカイブ済みだけなので、そこに絞って取る。
    expect(calls[0]?.url).toBe("/v1/me/articles")
  })

  it("toggles a selection on and off", async () => {
    stubArticles(3)
    const { result } = renderHookWithProviders(() => useArticlePicker(true))
    await waitFor(() => expect(result.current.articles).toHaveLength(3))

    act(() => result.current.onToggle("a1"))
    expect(result.current.selectedIds).toEqual(["a1"])

    act(() => result.current.onToggle("a1"))
    expect(result.current.selectedIds).toEqual([])
  })

  it("initializes the selection from the previous job", async () => {
    stubArticles(3)
    const { result } = renderHookWithProviders(() =>
      useArticlePicker(true, ["a1"])
    )

    await waitFor(() => expect(result.current.articles).toHaveLength(3))
    expect(result.current.selectedIds).toEqual(["a1"])
  })

  it("refuses to select past the contract's limit", async () => {
    stubArticles(MAX_SELECTED_ARTICLES + 5)
    const { result } = renderHookWithProviders(() => useArticlePicker(true))
    await waitFor(() =>
      expect(result.current.articles).toHaveLength(MAX_SELECTED_ARTICLES + 5)
    )

    act(() => result.current.onSelectTop())
    expect(result.current.selectedIds).toHaveLength(MAX_SELECTED_ARTICLES)
    expect(result.current.atLimit).toBe(true)

    // 上限に達した後の追加は黙って無視される（APIが422を返す状態を作らない）。
    act(() => result.current.onToggle(`a${MAX_SELECTED_ARTICLES + 1}`))
    expect(result.current.selectedIds).toHaveLength(MAX_SELECTED_ARTICLES)
  })

  it("clears the whole selection", async () => {
    stubArticles(3)
    const { result } = renderHookWithProviders(() => useArticlePicker(true))
    await waitFor(() => expect(result.current.articles).toHaveLength(3))

    act(() => result.current.onSelectTop())
    act(() => result.current.onClear())
    expect(result.current.selectedIds).toEqual([])
  })
})
