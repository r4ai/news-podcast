import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Episode } from "@/features/episodes"
import { EpisodeLibraryView } from "./episode-library"

function makeEpisode(index: number): Episode {
  return {
    id: `episode-${index}`,
    title: `番組 ${index}`,
    script: `台本 ${index}`,
    sources: [
      {
        articleId: `article-${index}`,
        title: `出典 ${index}`,
        url: `https://example.com/${index}`,
      },
    ],
    createdAt: new Date(Date.UTC(2026, 7, 19, 0, index)).toISOString(),
  } as Episode
}

function renderLibrary(
  overrides: Partial<Parameters<typeof EpisodeLibraryView>[0]> = {}
) {
  const props: Parameters<typeof EpisodeLibraryView>[0] = {
    episodes: Array.from({ length: 21 }, (_, index) => makeEpisode(index)),
    pending: false,
    play: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  }
  return { ...render(<EpisodeLibraryView {...props} />), props }
}

describe("EpisodeLibraryView", () => {
  it("21件目も再生でき、出典を確認できる", async () => {
    const user = userEvent.setup()
    const { props } = renderLibrary()
    const episode = screen.getByRole("heading", { name: "番組 20" })
    const card = episode.closest("[data-slot='card']")

    expect(card).not.toBeNull()
    await user.click(screen.getAllByRole("button", { name: "再生" })[20]!)
    expect(props.play).toHaveBeenCalledWith("episode-20")

    await user.click(screen.getAllByRole("button", { name: "出典を確認" })[20]!)
    expect(screen.getByRole("link", { name: "出典 20" })).toBeDefined()
  })

  it("続きの取得中をstatusで通知し、重複操作を止める", () => {
    renderLibrary({ hasNextPage: true, isFetchingNextPage: true })

    expect(
      screen.getByRole("status", { name: "続きを読み込み中" })
    ).toBeDefined()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "もっと読み込む" })
        .disabled
    ).toBe(true)
  })

  it("続きの取得失敗を通知し、同じ操作から再試行できる", async () => {
    const user = userEvent.setup()
    const fetchNextPage = vi.fn()
    renderLibrary({
      fetchNextPage,
      hasNextPage: true,
      isFetchNextPageError: true,
    })

    expect(screen.getByRole("alert").textContent).toContain(
      "続きを読み込めませんでした"
    )
    await user.click(screen.getByRole("button", { name: "再試行" }))
    expect(fetchNextPage).toHaveBeenCalledOnce()
  })
})
