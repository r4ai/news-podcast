import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

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
  playbackRateAtom,
  playbackStatusAtom,
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
  render(
    <TestProviders queryClient={queryClient} store={store}>
      <PlayerBar />
    </TestProviders>
  )
  return { audio, store }
}

describe("PlayerBar", () => {
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

  it("経過と残りを両方出す。残りは負号を付けて区別する", () => {
    renderBar()
    expect(screen.getByText("2:00")).toBeDefined()
    expect(screen.getByText("-8:00")).toBeDefined()
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

  it("速度は押すたびに巡回し、要素へも伝わる", async () => {
    const user = userEvent.setup()
    const { audio, store } = renderBar()

    await user.click(
      screen.getByRole("button", { name: "再生速度を変える (現在 1倍)" })
    )
    expect(store.get(playbackRateAtom)).toBe(1.25)
    expect(audio.playbackRate).toBe(1.25)
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
