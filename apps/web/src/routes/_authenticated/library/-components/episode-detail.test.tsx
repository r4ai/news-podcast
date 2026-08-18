import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { currentEpisodeIdAtom } from "@/features/player"
// 要素の取り付けはfeatureの内側の配線なので、公開の入口には出していない。
import { attachAudioElementAtom } from "@/features/player/atoms"
import {
  createTestQueryClient,
  createTestStore,
  stubFetch,
  TestProviders,
} from "@/shared/test/render"
import type { Episode } from "../-model"
import { EpisodeDetail } from "./episode-detail"

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    readonly children: ReactNode
    readonly to: string
    readonly search?: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const episode: Episode = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "今日の開発ニュース",
  script: "こんばんは。\n\n本日の話題は3つです。\n最初の話題から紹介します。",
  sources: [
    {
      url: "https://example.com/a",
      title: "保存済みの記事",
      articleId: "00000000-0000-4000-8000-0000000000aa",
      publishedAt: "2026-08-18T00:00:00.000Z",
      sourceKind: "rss",
    },
    { url: "https://example.com/b", title: "保存されていない記事" },
  ],
  createdAt: "2026-08-19T00:00:00.000Z",
}

function renderDetail() {
  stubFetch([{ path: `/v1/episodes/${episode.id}`, body: episode }])
  const queryClient = createTestQueryClient()
  const store = createTestStore(queryClient)
  const audio = {
    src: "",
    currentTime: 0,
    duration: Number.NaN,
    paused: true,
    playbackRate: 1,
    play: vi.fn(function (this: { paused: boolean }) {
      this.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(),
  }
  store.set(attachAudioElementAtom, audio as unknown as HTMLAudioElement)
  render(
    <TestProviders queryClient={queryClient} store={store}>
      <EpisodeDetail episodeId={episode.id} onBack={vi.fn()} />
    </TestProviders>
  )
  return { audio, store }
}

describe("EpisodeDetail", () => {
  it("原稿を段落に割って読ませる", async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText("こんばんは。")).toBeDefined())
    expect(screen.getByText("本日の話題は3つです。")).toBeDefined()
    expect(screen.getByText("最初の話題から紹介します。")).toBeDefined()
  })

  it("素性は生成時刻・出典件数・台本の長さで示す", async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText(/出典2件/)).toBeDefined())
    expect(screen.getByText(/台本\d+字/)).toBeDefined()
  })

  /**
   * 出典の器は幅で出し分けるために2つ描かれるが、支援技術へ露出するのは
   * 開いている側の1つだけ。同じ名前の`nav`が2つ見えると区別が付かなくなる
   * (axe: landmark-unique)。件数がそのまま「1つだけ」の検査になる。
   */
  it("出典は外部URLと、残っていれば保存版の両方へ辿れる", async () => {
    renderDetail()
    await waitFor(() =>
      expect(
        screen.getAllByRole("link", { name: /保存済みの記事/ })
      ).toHaveLength(1)
    )
    const external = screen.getByRole("link", { name: /保存済みの記事/ })
    expect(external.getAttribute("href")).toBe("https://example.com/a")
    expect(screen.getByRole("link", { name: "保存版を開く" })).toBeDefined()
  })

  it("保存されていない出典には保存版の導線を出さない", async () => {
    renderDetail()
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /保存されていない記事/ })
      ).toBeDefined()
    )
    // 保存版の導線は`articleId`を持つ1件ぶんだけ。
    expect(screen.getAllByRole("link", { name: "保存版を開く" })).toHaveLength(
      1
    )
  })

  it("再生ボタンは下端のバーへこの番組を載せる", async () => {
    const user = userEvent.setup()
    const { audio, store } = renderDetail()
    await waitFor(() => expect(screen.getByText(episode.title)).toBeDefined())

    await user.click(screen.getByRole("button", { name: "再生" }))

    expect(store.get(currentEpisodeIdAtom)).toBe(episode.id)
    expect(audio.play).toHaveBeenCalledTimes(1)
  })
})
