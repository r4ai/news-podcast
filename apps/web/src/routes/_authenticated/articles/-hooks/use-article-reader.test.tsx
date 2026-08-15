import { act, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  createTestQueryClient,
  stubFetch,
  TestProviders,
} from "@/shared/test/render"
import { MARKDOWN_FALLBACK_MIN_LENGTH, type Article } from "../-model"
import { useArticleReader, type ArticleReaderState } from "./use-article-reader"

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

/**
 * 本番と同じく`key={articleId}`でマウントする。記事の切り替えは
 * 「別インスタンスへの差し替え」であって、propsの更新ではない。
 */
function renderReader(routes: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(routes)
  const queryClient = createTestQueryClient()
  const state: { current?: ArticleReaderState } = {}

  function Reader({ articleId }: { readonly articleId: string }) {
    state.current = useArticleReader({ articleId })
    // commitされたことをDOMで観測できるようにする。render中の代入だけを見ると、
    // Effect (既読フラッシュの登録) が走る前にテストが進んでしまう。
    return <p data-testid="reader">{state.current.article.title}</p>
  }

  function Harness({ articleId }: { readonly articleId: string }) {
    return (
      <TestProviders queryClient={queryClient}>
        <Reader articleId={articleId} key={articleId} />
      </TestProviders>
    )
  }

  const utils = render(<Harness articleId="a" />)
  return {
    ...utils,
    ...stub,
    state,
    selectArticle: (articleId: string) =>
      utils.rerender(<Harness articleId={articleId} />),
  }
}

/** Suspenseが解けてcommitされるまで待つ。Effectの登録もここで完了する。 */
async function readerReady() {
  await screen.findByTestId("reader")
}

describe("useArticleReader", () => {
  it("keeps markdown as the source when the archived body is long enough", async () => {
    const { state } = renderReader([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
    ])

    await readerReady()
    await waitFor(() => expect(state.current?.source).toBe("markdown"))
    expect(state.current?.didAutoFallback).toBe(false)
  })

  it("marks raw archive content unavailable when markdown is too short", async () => {
    const { state } = renderReader([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", raw: shortMarkdown },
    ])

    await waitFor(() => expect(state.current?.source).toBe("archive"))
    expect(state.current?.didAutoFallback).toBe(true)
    expect(state.current?.archiveHtml).toBeUndefined()
    expect(state.current?.archiveUnavailable).toBe(true)
  })

  it("keeps the reader usable when the body fails to load", async () => {
    const { state } = renderReader([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", status: 500, body: {} },
    ])

    // 本文の取得失敗はアーカイブ表示への分岐であって、境界へ投げる欠陥ではない。
    await waitFor(() => expect(state.current?.source).toBe("archive"))
    expect(state.current?.article).toBeDefined()
  })

  it("does not mark an unread article as read while it is open", async () => {
    const { calls } = renderReader([
      { path: "/v1/me/articles/a", body: makeArticle({ read: false }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
    ])

    await readerReady()
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0)
  })

  it("marks an unread article as read when switching to another article", async () => {
    const rendered = renderReader([
      { path: "/v1/me/articles/a", body: makeArticle({ read: false }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      { path: "/v1/me/articles/b", body: makeArticle({ id: "b" }) },
      { path: "/v1/me/articles/b/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: true }),
      },
    ])

    await readerReady()
    await act(async () => rendered.selectArticle("b"))

    await waitFor(() =>
      expect(rendered.calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    const patch = rendered.calls.find((call) => call.method === "PATCH")
    expect(patch?.url).toBe("/v1/me/articles/a")
    expect(patch?.body).toEqual({ read: true })
  })

  it("marks pending unread articles as read when the reader unmounts", async () => {
    const rendered = renderReader([
      { path: "/v1/me/articles/a", body: makeArticle({ read: false }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: true }),
      },
    ])

    await readerReady()
    await act(async () => rendered.unmount())

    await waitFor(() =>
      expect(rendered.calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    expect(
      rendered.calls.find((call) => call.method === "PATCH")?.body
    ).toEqual({ read: true })
  })

  it("marks pending unread articles as read on pagehide", async () => {
    const rendered = renderReader([
      { path: "/v1/me/articles/a", body: makeArticle({ read: false }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: true }),
      },
    ])

    await readerReady()
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"))
    })

    await waitFor(() =>
      expect(rendered.calls.some((call) => call.method === "PATCH")).toBe(true)
    )
    expect(
      rendered.calls.find((call) => call.method === "PATCH")?.body
    ).toEqual({ read: true })
  })

  it("sends only the toggled flag when saving", async () => {
    const { state, calls } = renderReader([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: true, saved: true }),
      },
    ])
    await readerReady()

    await act(async () => state.current?.toggleSaved())

    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      saved: true,
    })
  })

  it("keeps an article unread when the user marks it unread and leaves", async () => {
    const rendered = renderReader([
      { path: "/v1/me/articles/a", body: makeArticle({ read: true }) },
      { path: "/v1/me/articles/a/markdown", raw: longMarkdown },
      {
        method: "PATCH",
        path: "/v1/me/articles/a",
        body: makeArticle({ read: false }),
      },
    ])
    await readerReady()

    await act(async () => rendered.state.current?.markUnread())
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
