import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  createTestQueryClient,
  stubFetch,
  TestProviders,
} from "@/shared/test/render"
import type { Episode } from "../-model"
import { EpisodeList } from "./episode-list"

const PAGE_SIZE = 20

function makeEpisode(index: number): Episode {
  return {
    id: `episode-${index}`,
    title: `番組 ${index}`,
    script: `台本 ${index}`,
    sources: [{ url: `https://example.com/${index}`, title: `出典 ${index}` }],
    createdAt: new Date(Date.UTC(2026, 7, 19, 0, index)).toISOString(),
  }
}

const firstPage = Array.from({ length: PAGE_SIZE }, (_, index) =>
  makeEpisode(index)
)
const secondPage = [makeEpisode(PAGE_SIZE)]

function renderList(routes: Parameters<typeof stubFetch>[0]) {
  stubFetch(routes)
  const queryClient = createTestQueryClient()
  render(
    <TestProviders queryClient={queryClient}>
      <EpisodeList onSelect={vi.fn()} selectedEpisodeId={undefined} />
    </TestProviders>
  )
}

describe("EpisodeList", () => {
  it("21件目はcursorを辿って初めて出る。1ページ目で打ち切らない", async () => {
    const user = userEvent.setup()
    renderList([
      {
        path: "/v1/episodes",
        query: { cursor: undefined },
        body: {
          items: firstPage,
          page: { hasMore: true, nextCursor: "cursor-2" },
        },
      },
      {
        path: "/v1/episodes",
        query: { cursor: "cursor-2" },
        body: { items: secondPage, page: { hasMore: false } },
      },
    ])

    await waitFor(() => expect(screen.getByText("番組 0")).toBeDefined())
    expect(screen.queryByText("番組 20")).toBeNull()

    await user.click(screen.getByRole("button", { name: "もっと読み込む" }))
    await waitFor(() => expect(screen.getByText("番組 20")).toBeDefined())
  })

  it("続きの取得失敗は黙って止めず、同じ場所から再試行させる", async () => {
    const user = userEvent.setup()
    renderList([
      {
        path: "/v1/episodes",
        query: { cursor: undefined },
        body: {
          items: firstPage,
          page: { hasMore: true, nextCursor: "cursor-2" },
        },
      },
      {
        path: "/v1/episodes",
        query: { cursor: "cursor-2" },
        status: 503,
        body: { title: "unavailable" },
      },
    ])

    await waitFor(() => expect(screen.getByText("番組 0")).toBeDefined())
    await user.click(screen.getByRole("button", { name: "もっと読み込む" }))

    // 1ページ目は消えない。失敗したのは続きの取得だけで、`Panel`までは上げない。
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "続きを読み込めませんでした"
      )
    )
    expect(screen.getByText("番組 0")).toBeDefined()
    expect(screen.getByRole("button", { name: "再試行" })).toBeDefined()
  })

  it("1件も無ければ、最初の番組を作る導線を示す", async () => {
    renderList([
      { path: "/v1/episodes", body: { items: [], page: { hasMore: false } } },
    ])

    await waitFor(() =>
      expect(screen.getByText("完成した番組はまだありません")).toBeDefined()
    )
  })
})
