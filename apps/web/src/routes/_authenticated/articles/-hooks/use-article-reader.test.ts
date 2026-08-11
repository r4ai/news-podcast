import { act, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import { MARKDOWN_FALLBACK_MIN_LENGTH, type Article } from "../-model"
import { useArticleReader } from "./use-article-reader"

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
    usedInEpisode: false,
    ...overrides,
  } as Article
}

const longMarkdown = "# 本文\n\n" + "a".repeat(MARKDOWN_FALLBACK_MIN_LENGTH)
const shortMarkdown = "短い"

function render(routes: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(routes)
  const rendered = renderHookWithProviders(
    ({ articleId }: { articleId: string | undefined }) =>
      useArticleReader({ articleId }),
    { initialProps: { articleId: "a" } }
  )
  return { ...rendered, ...stub }
}

describe("useArticleReader", () => {
  it("keeps markdown as the source when the archived body is long enough", async () => {
    const { result } = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
    ])

    await waitFor(() => expect(result.current.article).toBeDefined())
    await waitFor(() => expect(result.current.source).toBe("markdown"))
    expect(result.current.didAutoFallback).toBe(false)
  })

  it("falls back to archive and marks it as an automatic switch when markdown is too short", async () => {
    const { result } = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", raw: shortMarkdown },
      {
        path: "/v1/me/articles/a/archive",
        raw: "<html><body>archive</body></html>",
        contentType: "text/html",
      },
    ])

    await waitFor(() => expect(result.current.source).toBe("archive"))
    expect(result.current.didAutoFallback).toBe(true)
    await waitFor(() =>
      expect(result.current.archiveHtml).toBe(
        "<html><body>archive</body></html>"
      )
    )
  })

  it("marks an unread article as read once, automatically, when it is opened", async () => {
    const { calls } = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: false }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: true }),
      },
    ])

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual({ read: true })
  })

  it("sends only the toggled flag when saving", async () => {
    const { result, calls } = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: true, saved: true }),
      },
    ])
    await waitFor(() => expect(result.current.article).toBeDefined())

    await act(async () => result.current.toggleSaved())

    const patch = calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual({ saved: true })
  })
})
