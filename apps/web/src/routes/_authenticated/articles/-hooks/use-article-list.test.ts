import { act, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import type { Article } from "../-model"
import { applyDraft, useArticleList } from "./use-article-list"

vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const items = [
  { id: "a", title: "React 19", sourceName: "Zenn", saved: false, read: false },
  { id: "b", title: "OTel", sourceName: "HN", saved: true, read: false },
] as unknown as Article[]

describe("applyDraft", () => {
  it("merges the patch into the targeted article only", () => {
    const next = applyDraft(items, { id: "a", patch: { saved: true } })
    expect(next[0]?.saved).toBe(true)
    expect(next[1]).toBe(items[1])
  })
})

describe("useArticleList", () => {
  async function renderList(routes: Parameters<typeof stubFetch>[0]) {
    const stub = stubFetch(routes)
    const rendered = renderHookWithProviders(() => useArticleList())
    await waitFor(() =>
      expect(rendered.result.current.articles).toHaveLength(2)
    )
    return { ...rendered, ...stub }
  }

  it("filters on the deferred search term", async () => {
    const { result } = await renderList([
      { path: "/v1/me/articles", body: { items } },
    ])

    act(() => result.current.setSearch("zenn"))

    await waitFor(() => expect(result.current.articles).toHaveLength(1))
    expect(result.current.articles[0]?.id).toBe("a")
  })

  it("sends only the changed flag when saving an article", async () => {
    const { result, calls } = await renderList([
      { path: "/v1/me/articles", body: { items } },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: { ...items[0], saved: true },
      },
    ])

    await act(async () => result.current.toggleSaved(items[0]!))

    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual({ saved: true })
  })

  it("marks an article read when its archive is opened", async () => {
    const { result, calls } = await renderList([
      { path: "/v1/me/articles", body: { items } },
      {
        method: "PATCH",
        path: "/v1/me/articles/b",
        body: { ...items[1], read: true },
      },
    ])

    await act(async () => result.current.markRead(items[1]!))

    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      read: true,
    })
  })
})
