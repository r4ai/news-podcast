import { render, screen, waitFor } from "@testing-library/react"
import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  attachAudioElementAtom,
  playEpisodeAtom,
  playbackPositionAtom,
  togglePlaybackAtom,
} from "@/features/player/atoms"
import {
  createTestQueryClient,
  createTestStore,
  stubFetch,
  TestProviders,
} from "@/shared/test/render"
import {
  renderCount,
  resetRenderCounts,
  waitForRenderQuiescence,
} from "@/shared/test/render-count"
import type { Episode } from "../-model"
import { EpisodeList } from "./episode-list"

// 実物の行をそのまま包んで数える。JSXのtypeは安定するので、親のメモ化に
// よるbailoutは包む前と同じように効く。
vi.mock("./episode-row", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./episode-row")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return {
    ...actual,
    EpisodeRow: watchRenders("EpisodeRow", actual.EpisodeRow),
  }
})

const EPISODE_COUNT = 20

const items: Episode[] = Array.from({ length: EPISODE_COUNT }, (_, index) => ({
  id: `episode-${index}`,
  title: `番組 ${index}`,
  script: "台本",
  sources: [{ url: `https://example.com/${index}`, title: "出典" }],
  createdAt: "2026-08-19T00:00:00.000Z",
}))

function fakeAudio() {
  return {
    src: "",
    currentTime: 0,
    duration: 600,
    paused: true,
    playbackRate: 1,
    play: vi.fn(function (this: { paused: boolean }) {
      this.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true
    }),
  }
}

async function renderList() {
  stubFetch([
    { path: "/v1/episodes", body: { items, page: { hasMore: false } } },
  ])
  const queryClient = createTestQueryClient()
  const store = createTestStore(queryClient)
  const audio = fakeAudio()
  store.set(attachAudioElementAtom, audio as unknown as HTMLAudioElement)
  render(
    <TestProviders queryClient={queryClient} store={store}>
      <EpisodeList onSelect={vi.fn()} selectedEpisodeId={undefined} />
    </TestProviders>
  )
  await waitFor(() => expect(screen.getByText("番組 0")).toBeDefined())
  await waitForRenderQuiescence(waitFor, "EpisodeRow")
  return { store }
}

describe("番組一覧の描画範囲", () => {
  beforeEach(() => resetRenderCounts())

  /**
   * 再生位置は毎秒数回動く。一覧に出るのは題名と素性だけで、位置は1文字も
   * 出ない。行が描き直された回数がそのまま無駄な仕事の量になる。
   */
  it("再生位置が動いても番組行を描き直さない", async () => {
    const { store } = await renderList()
    const before = renderCount("EpisodeRow")

    await act(async () => {
      for (const position of [1, 2, 3, 4, 5]) {
        store.set(playbackPositionAtom, position)
      }
    })
    await waitFor(() => {})

    const after = renderCount("EpisodeRow") - before
    expect(after, `位置の更新だけで番組行が${after}回描き直された`).toBe(0)
  })

  /**
   * 再生/停止で状態が変わるのは、その番組の再生ボタン1つだけ。
   * 行そのものは何も変わらないので、一覧全体を描き直す理由が無い。
   */
  it("再生と一時停止で番組行を描き直さない", async () => {
    const { store } = await renderList()
    const before = renderCount("EpisodeRow")

    await act(async () => {
      store.set(playEpisodeAtom, {
        episodeId: items[0]!.id,
        title: items[0]!.title,
        createdAt: items[0]!.createdAt,
      })
    })
    await act(async () => {
      store.set(togglePlaybackAtom)
    })
    await waitFor(() => {})

    const after = renderCount("EpisodeRow") - before
    expect(after, `再生と停止で番組行が${after}回描き直された`).toBe(0)
  })
})
