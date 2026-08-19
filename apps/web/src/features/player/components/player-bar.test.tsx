import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createTestQueryClient,
  createTestStore,
  TestProviders,
} from "@/shared/test/render"
import {
  attachAudioElementAtom,
  currentTrackAtom,
  playbackDurationAtom,
  playbackPositionAtom,
  mutedAtom,
  playbackRateAtom,
  playbackStatusAtom,
  volumeAtom,
} from "../atoms"
import { PlayerBar } from "./player-bar"

// routeの外にあるバーだけを見たいので、リンクは素の`<a>`へ置き換える。
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

const track = {
  episodeId: "episode-a",
  title: "今日のニュース",
  createdAt: "2026-08-19T00:00:00.000Z",
}

function fakeAudio() {
  return {
    src: "",
    currentTime: 0,
    duration: 600,
    paused: true,
    playbackRate: 1,
    volume: 1,
    muted: false,
    play: vi.fn(function (this: { paused: boolean }) {
      this.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true
    }),
    removeAttribute: vi.fn(),
  }
}

function renderBar(patch: { readonly playing?: boolean } = {}) {
  const queryClient = createTestQueryClient()
  const store = createTestStore(queryClient)
  const audio = fakeAudio()
  store.set(attachAudioElementAtom, audio as unknown as HTMLAudioElement)
  store.set(currentTrackAtom, track)
  store.set(playbackDurationAtom, 600)
  store.set(playbackPositionAtom, 120)
  if (patch.playing) {
    audio.paused = false
    store.set(playbackStatusAtom, "playing")
  }
  const view = render(
    <TestProviders queryClient={queryClient} store={store}>
      <PlayerBar />
    </TestProviders>
  )
  return { audio, store, container: view.container }
}

describe("PlayerBar", () => {
  // 速度と音量は端末に残る。前のテストの値が次のテストへ持ち越されない。
  beforeEach(() => localStorage.clear())

  it("番組が載っていなければ何も描かない。空の枠が居座らない", () => {
    const queryClient = createTestQueryClient()
    render(
      <TestProviders queryClient={queryClient}>
        <PlayerBar />
      </TestProviders>
    )
    expect(screen.queryByRole("region", { name: "再生中の番組" })).toBeNull()
  })

  it("題名からライブラリの該当番組へ辿れる", () => {
    renderBar()
    expect(screen.getByRole("link", { name: track.title })).toBeDefined()
  })

  it("経過・総時間・残りを1行に並べる", () => {
    const { container } = renderBar()
    expect(container.textContent).toContain("2:00 / 10:00 (残り 8:00)")
  })

  it("目盛りは幅いっぱいの縁に置く。狭い幅で数十pxまで縮まない", () => {
    renderBar()
    const scrubber = screen.getByRole("slider", { name: "再生位置" })
    // 掴み代は帯より広く、バーの上端の縁に重ねる。
    expect(scrubber.parentElement?.className).toContain("inset-x-0")
    expect(scrubber.parentElement?.className).toContain("top-0")
  })

  it("再生中は一時停止として押せる", async () => {
    const user = userEvent.setup()
    const { audio } = renderBar({ playing: true })

    await user.click(screen.getByRole("button", { name: "一時停止" }))
    expect(audio.pause).toHaveBeenCalledTimes(1)
  })

  it("止まっていれば再生として押せる", async () => {
    const user = userEvent.setup()
    const { audio } = renderBar()

    await user.click(screen.getByRole("button", { name: "再生" }))
    expect(audio.play).toHaveBeenCalledTimes(1)
  })

  it("15秒戻し・30秒送りは今の位置を基準に動かす", async () => {
    const user = userEvent.setup()
    const { audio } = renderBar()
    audio.currentTime = 120

    await user.click(screen.getByRole("button", { name: "15秒戻す" }))
    expect(audio.currentTime).toBe(105)

    await user.click(screen.getByRole("button", { name: "30秒進める" }))
    expect(audio.currentTime).toBe(135)
  })

  it("目盛りを動かすと、その位置へ飛ぶ", () => {
    const { audio } = renderBar()
    const scrubber = screen.getByRole("slider", { name: "再生位置" })

    // rangeの値変更はchangeイベントで届く。userEventのclickでは動かない。
    scrubber.dispatchEvent(new Event("input", { bubbles: true }))
    Object.defineProperty(scrubber, "value", { value: "300", writable: true })
    scrubber.dispatchEvent(new Event("change", { bubbles: true }))

    expect(audio.currentTime).toBe(300)
  })

  it("速度は候補から選ぶ。狙った速度へ1操作で着く", async () => {
    const user = userEvent.setup()
    const { audio, store } = renderBar()

    await user.click(screen.getByRole("combobox", { name: /再生速度/ }))
    await user.click(await screen.findByRole("option", { name: "1.5×" }))

    expect(store.get(playbackRateAtom)).toBe(1.5)
    expect(audio.playbackRate).toBe(1.5)
  })

  it("音量は開く操作を挟まずに触れる", async () => {
    const { audio, store } = renderBar()
    const volume = screen.getByRole("slider", { name: "音量" })

    Object.defineProperty(volume, "value", { value: "0.4", writable: true })
    volume.dispatchEvent(new Event("change", { bubbles: true }))

    expect(store.get(volumeAtom)).toBe(0.4)
    expect(audio.volume).toBe(0.4)
  })

  it("消音は押して切り替える。音量の記憶は残る", async () => {
    const user = userEvent.setup()
    const { audio, store } = renderBar()

    await user.click(screen.getByRole("button", { name: "消音にする" }))

    expect(store.get(mutedAtom)).toBe(true)
    expect(audio.muted).toBe(true)
    expect(store.get(volumeAtom)).toBe(1)
  })

  it("閉じると音は止まり、バーも消える", async () => {
    const user = userEvent.setup()
    const { audio, store } = renderBar({ playing: true })

    await user.click(
      screen.getByRole("button", { name: "再生を終了してバーを閉じる" })
    )
    expect(audio.pause).toHaveBeenCalled()
    expect(store.get(currentTrackAtom)).toBeNull()
    expect(screen.queryByRole("region", { name: "再生中の番組" })).toBeNull()
  })
})
