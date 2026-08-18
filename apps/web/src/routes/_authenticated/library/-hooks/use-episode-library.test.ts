import { act, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { Episode } from "@/features/episodes"
import { renderHookWithProviders, stubFetch } from "@/shared/test/render"
import { useEpisodeLibrary } from "./use-episode-library"

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

describe("useEpisodeLibrary", () => {
  it("21件目をserver cursorから取得し、順序と一意性を保って追加する", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      makeEpisode(index)
    )
    const lastEpisode = makeEpisode(20)
    const { calls } = stubFetch([
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
        body: { items: [lastEpisode], page: { hasMore: false } },
      },
    ])

    const { result } = renderHookWithProviders(useEpisodeLibrary)
    await waitFor(() => expect(result.current.episodes).toHaveLength(20))

    await act(async () => result.current.fetchNextPage())

    await waitFor(() => expect(result.current.episodes).toHaveLength(21))
    expect(result.current.episodes.map((episode) => episode.id)).toEqual(
      Array.from({ length: 21 }, (_, index) => `episode-${index}`)
    )
    expect(
      new Set(result.current.episodes.map((episode) => episode.id)).size
    ).toBe(21)
    expect(result.current.hasNextPage).toBe(false)
    const cursors = calls
      .filter((call) => call.url === "/v1/episodes")
      .map((call) => call.search.get("cursor"))
    expect(cursors[0]).toBeNull()
    expect(cursors.filter((cursor) => cursor === "cursor-2")).toHaveLength(1)
  })
})
