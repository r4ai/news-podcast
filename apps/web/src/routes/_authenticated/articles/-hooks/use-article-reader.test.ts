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

  it("marks raw archive content unavailable when markdown is too short", async () => {
    const { result } = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", raw: shortMarkdown },
    ])

    await waitFor(() => expect(result.current.source).toBe("archive"))
    expect(result.current.didAutoFallback).toBe(true)
    expect(result.current.archiveHtml).toBeUndefined()
    expect(result.current.archiveUnavailable).toBe(true)
  })

  it("does not mark an unread article as read while it is open", async () => {
    const { result, calls } = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: false }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
    ])

    await waitFor(() => expect(result.current.article).toBeDefined())
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0)
  })

  it("marks an unread article as read when switching to another article", async () => {
    const rendered = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: false }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: true }),
      },
    ])

    await waitFor(() => expect(rendered.result.current.article).toBeDefined())

    await act(async () => rendered.rerender({ articleId: "b" }))

    await waitFor(() =>
      expect(rendered.calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    const patch = rendered.calls.find((call) => call.method === "PATCH")
    expect(patch?.url).toBe("/v1/me/articles/a")
    expect(patch?.body).toEqual({ read: true })
  })

  it("marks pending unread articles as read when the reader unmounts", async () => {
    const rendered = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: false }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: true }),
      },
    ])

    await waitFor(() => expect(rendered.result.current.article).toBeDefined())

    await act(async () => rendered.unmount())

    await waitFor(() =>
      expect(rendered.calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    const patch = rendered.calls.find((call) => call.method === "PATCH")
    expect(patch?.body).toEqual({ read: true })
  })

  it("marks pending unread articles as read on pagehide", async () => {
    const rendered = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: false }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: true }),
      },
    ])

    await waitFor(() => expect(rendered.result.current.article).toBeDefined())

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"))
    })

    await waitFor(() =>
      expect(rendered.calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    const patch = rendered.calls.find((call) => call.method === "PATCH")
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

  it("keeps an article unread when the user marks it unread and leaves", async () => {
    const rendered = render([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: false }),
      },
    ])
    await waitFor(() => expect(rendered.result.current.article).toBeDefined())

    await act(async () => rendered.result.current.markUnread())
    await act(async () => rendered.unmount())

    await waitFor(() =>
      expect(
        rendered.calls.some(
          (call) =>
            call.method === "PATCH" &&
            (call.body as { read?: boolean } | undefined)?.read === false
        )
      ).toBe(true)
    )
    expect(
      rendered.calls.some(
        (call) =>
          call.method === "PATCH" &&
          (call.body as { read?: boolean } | undefined)?.read === true
      )
    ).toBe(false)
  })
})
