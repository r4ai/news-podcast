import { render, screen, waitFor } from "@testing-library/react"
import { act } from "react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  TestProviders,
  createTestQueryClient,
  stubFetch,
} from "@/shared/test/render"
import {
  renderCount,
  resetRenderCounts,
  waitForRenderQuiescence,
} from "@/shared/test/render-count"
import { defaultArticlesSearch, type Article } from "../-model"
import { ARTICLE_FACETS_QUERY_KEY } from "../-queries"
import { ArticleList } from "./article-list"

vi.mock("@/shared/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// 実物の行をそのまま包んで数える。JSXのtypeは安定するので、親のメモ化に
// よるbailoutは包む前と同じように効く。
vi.mock("./article-row", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./article-row")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return {
    ...actual,
    ArticleRow: watchRenders("ArticleRow", actual.ArticleRow),
  }
})
vi.mock("./article-list-header", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./article-list-header")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return {
    ...actual,
    ArticleListHeader: watchRenders(
      "ArticleListHeader",
      actual.ArticleListHeader
    ),
  }
})

const ARTICLE_COUNT = 30

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

const items = Array.from({ length: ARTICLE_COUNT }, (_, index) =>
  makeArticle(index)
)

const routes = [
  { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
  {
    path: "/v1/me/articles/facets",
    body: {
      states: { all: ARTICLE_COUNT, unread: ARTICLE_COUNT, saved: 0, later: 0 },
      feeds: [{ feedId: "feed-1", name: "Zenn", count: ARTICLE_COUNT }],
      aiPending: 0,
    },
  },
  { path: "/v1/me/feed-sync-jobs", body: { items: [] } },
] as const

async function renderList() {
  stubFetch([...routes])
  const queryClient = createTestQueryClient()
  render(
    <TestProviders queryClient={queryClient}>
      <ArticleList
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
        search={defaultArticlesSearch}
        selectedArticleId={undefined}
      />
    </TestProviders>
  )
  await waitFor(() => expect(screen.getByText("記事 0")).toBeDefined())
}

describe("記事一覧の描画範囲", () => {
  beforeEach(() => resetRenderCounts())

  /**
   * 検索欄への打鍵は、入力欄と同じ枠の中だけを描き直せば足りる。
   * URLへ反映されるまでは一覧の中身は1件も変わらないので、行が描き直された
   * 回数がそのまま無駄な仕事の量になる。
   */
  it("検索欄への打鍵で記事行を描き直さない", async () => {
    const user = userEvent.setup()
    await renderList()
    // facetsや同期ジョブは一覧より後に届く。その分の描画は操作とは無関係
    // なので、収まってから基準を取る。
    await waitForRenderQuiescence(waitFor, "ArticleRow")

    const rowsAfterMount = renderCount("ArticleRow")
    const headerAfterMount = renderCount("ArticleListHeader")
    expect(rowsAfterMount).toBeGreaterThanOrEqual(ARTICLE_COUNT)

    const search = screen.getByRole("textbox", { name: "記事を検索" })
    await user.type(search, "react")

    const rowRenders = renderCount("ArticleRow") - rowsAfterMount
    const headerRenders = renderCount("ArticleListHeader") - headerAfterMount
    expect(rowRenders, `5打鍵で記事行が${rowRenders}回描き直された`).toBe(0)
    // ヘッダーも巻き込まない。描き直すのは入力欄だけで足りる。
    expect(
      headerRenders,
      `5打鍵でヘッダーが${headerRenders}回描き直された`
    ).toBe(0)
  })

  /**
   * 件数は一覧ヘッダーにしか出ない。記事の中身は1件も変わらないので、
   * 行が描き直された回数がそのまま無駄な仕事の量になる。
   */
  it("件数(facets)の更新で記事行を描き直さない", async () => {
    stubFetch([
      { path: "/v1/me/articles", body: { items, page: { hasMore: false } } },
      {
        path: "/v1/me/articles/facets",
        body: {
          states: { all: 30, unread: 30, saved: 0, later: 0 },
          feeds: [{ feedId: "feed-1", name: "Zenn", count: 30 }],
          aiPending: 0,
        },
      },
      { path: "/v1/me/feed-sync-jobs", body: { items: [] } },
    ])
    const queryClient = createTestQueryClient()
    render(
      <TestProviders queryClient={queryClient}>
        <ArticleList
          onSearchChange={vi.fn()}
          onSelect={vi.fn()}
          search={defaultArticlesSearch}
          selectedArticleId={undefined}
        />
      </TestProviders>
    )
    await waitFor(() => expect(screen.getByText("記事 0")).toBeDefined())
    await waitForRenderQuiescence(waitFor, "ArticleRow")
    const before = renderCount("ArticleRow")

    // 件数だけを書き換える。記事の中身は1件も変わっていない。
    await act(async () => {
      queryClient.setQueriesData(
        { queryKey: ARTICLE_FACETS_QUERY_KEY },
        {
          states: { all: 30, unread: 29, saved: 1, later: 0 },
          feeds: [{ feedId: "feed-1", name: "Zenn", count: 30 }],
          aiPending: 0,
        }
      )
    })
    await waitFor(() => {})

    const after = renderCount("ArticleRow") - before
    expect(after, `件数の更新だけで記事行が${after}回描き直された`).toBe(0)
  })
})
