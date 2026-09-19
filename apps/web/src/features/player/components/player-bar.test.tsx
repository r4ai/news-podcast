import { act } from "react"
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
  handlePlayingAtom,
  handleWaitingAtom,
  playbackDurationAtom,
  playbackPositionAtom,
  mutedAtom,
  playbackRateAtom,
  playbackStatusAtom,
  playerExpandedAtom,
  volumeAtom,
  type PlaybackStatus,
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
    load: vi.fn(),
    removeAttribute: vi.fn(),
  }
}

function renderBar(
  patch: { readonly playing?: boolean; readonly status?: PlaybackStatus } = {}
) {
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
  if (patch.status) store.set(playbackStatusAtom, patch.status)
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

  it("目盛りは板の上端の縁いっぱいに置く。狭い幅で数十pxまで縮まない", () => {
    renderBar()
    const scrubber = screen.getByRole("slider", { name: "再生位置" })
    // 掴み代は帯より広く、板の上端の縁に重ねる。
    const edge = scrubber.parentElement?.parentElement
    expect(edge?.className).toContain("inset-x-0")
    expect(edge?.className).toContain("top-0")
  })

  it("折りたたみ時の目盛りにつまみを出さない。帯から浮いて見えない", () => {
    renderBar()
    const scrubber = screen.getByRole("slider", { name: "再生位置" })
    /*
      帯は板の上端の縁に密着しているが、UAのつまみは掴み代の中央へ置かれる
      ので、帯の中心より5px下にぶら下がる。帯へ合わせて持ち上げるには掴み代の
      外へ出すしかなく、そこは板の`overflow-hidden`が切る。幅を持たせない。
    */
    expect(scrubber.className).toContain("[&::-webkit-slider-thumb]:w-0")
    expect(scrubber.className).toContain("[&::-moz-range-thumb]:w-0")
  })

  it("目盛りの両端は角の丸みの内側に収める。先頭と末尾を掴める", () => {
    renderBar()
    const scrubber = screen.getByRole("slider", { name: "再生位置" })
    /*
      板は`rounded-3xl`(1.5rem)で、`overflow-hidden`の丸めはヒットテストにも
      効く。端まで伸ばすと両端が角のカーブの外に出て、「先頭へ戻す」
      「末尾へ飛ぶ」が掴めなくなる。角の半径ぶんの余白でそれを防ぐ。
    */
    expect(scrubber.parentElement?.parentElement?.className).toContain("px-6")
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

describe("PlayerBar の読み込みと失敗", () => {
  beforeEach(() => localStorage.clear())

  it("音が届くまでは待っていることを見せる", async () => {
    const { store } = renderBar({ playing: true })
    await act(async () => store.set(handleWaitingAtom))

    expect(
      screen.getByRole("button", { name: "一時停止" }).getAttribute("aria-busy")
    ).toBe("true")
    expect(screen.getByText("読み込み中…")).toBeDefined()

    await act(async () => store.set(handlePlayingAtom))
    expect(screen.queryByText("読み込み中…")).toBeNull()
  })

  /*
    待ちの表示と時刻は、**同じ1行を入れ替える**。

    並べて置くと、320pxでは題名の列(102px)へ137px入れることになり、再生
    ボタンへ重なる。待っている間は位置も動かないので、入れ替えて構わない。
  */
  it("待っている間は、時刻ではなく理由だけを出す。再生ボタンへ重ならない", async () => {
    const { container, store } = renderBar({ playing: true })
    expect(container.textContent).toContain("2:00 / 10:00")

    await act(async () => store.set(handleWaitingAtom))

    expect(screen.getByText("読み込み中…")).toBeDefined()
    expect(container.textContent).not.toContain("2:00 / 10:00")

    await act(async () => store.set(handlePlayingAtom))
    expect(container.textContent).toContain("2:00 / 10:00")
  })

  it("鳴らせなかったことを伝え、その場でやり直せる", async () => {
    const user = userEvent.setup()
    const { audio } = renderBar({ status: "error" })

    expect(screen.getByRole("alert").textContent).toContain(
      "音声を再生できませんでした"
    )

    await user.click(screen.getByRole("button", { name: "再試行" }))
    expect(audio.load).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

/**
 * 段の開閉。
 *
 * 常設の1行には題名と再生しか入らない。入り切らないもの (大きい目盛り・
 * 速度・音量・原稿への道) へ**必ず辿り着ける**ことと、辿り着いた先で同じ
 * ものが二重に並ばないことを固定する。
 */
describe("PlayerBar の展開", () => {
  beforeEach(() => localStorage.clear())

  it("初めは畳んでいる。聴いていない間まで本文を削らない", () => {
    renderBar()
    expect(
      screen
        .getByRole("button", { name: "再生の詳細" })
        .getAttribute("aria-expanded")
    ).toBe("false")
    expect(screen.queryByRole("link", { name: "原稿と出典を読む" })).toBeNull()
  })

  it("展開すると、常設の行に入らないものが出る", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByRole("button", { name: "再生の詳細" }))

    expect(
      screen
        .getByRole("button", { name: "再生の詳細" })
        .getAttribute("aria-expanded")
    ).toBe("true")
    expect(screen.getByRole("link", { name: "原稿と出典を読む" })).toBeDefined()
    // 残りは負の符号で右端に出る。経過と同じ書式で並べると読み分けられない。
    expect(screen.getByText("-8:00")).toBeDefined()
  })

  /*
    320pxでは、おもり(72px)・操作列(156px)・開閉(74px)の合計が板を38px超える。
    おもりは中央に据えるためだけのものなので、縮む余地を残して**収まることを
    優先**する。`shrink-0`を付けると、そのぶんが板の外へ溢れる。
  */
  it("展開時の釣り合いのおもりは縮められる。狭い幅で操作列が溢れない", async () => {
    const user = userEvent.setup()
    const { container } = renderBar()
    await user.click(screen.getByRole("button", { name: "再生の詳細" }))

    const weight = container.querySelector("span.w-18")
    expect(weight).not.toBeNull()
    expect(weight?.className).not.toContain("shrink-0")
  })

  it("展開しても題名と目盛りは1つずつ。段をまたいで重ならない", async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByRole("button", { name: "再生の詳細" }))

    expect(screen.getAllByRole("link", { name: track.title })).toHaveLength(1)
    expect(screen.getAllByRole("slider", { name: "再生位置" })).toHaveLength(1)
    expect(screen.getAllByRole("slider", { name: "音量" })).toHaveLength(1)
  })

  it("展開中の目盛りも、掴んだ位置へ飛ばせる", async () => {
    const user = userEvent.setup()
    const { audio } = renderBar()
    await user.click(screen.getByRole("button", { name: "再生の詳細" }))

    const scrubber = screen.getByRole("slider", { name: "再生位置" })
    Object.defineProperty(scrubber, "value", { value: "420", writable: true })
    scrubber.dispatchEvent(new Event("change", { bubbles: true }))

    expect(audio.currentTime).toBe(420)
  })

  it("Escapeは畳むだけ。音は止めない", async () => {
    const user = userEvent.setup()
    const { store } = renderBar({ playing: true })
    await user.click(screen.getByRole("button", { name: "再生の詳細" }))

    await user.keyboard("{Escape}")

    expect(store.get(playerExpandedAtom)).toBe(false)
    expect(store.get(currentTrackAtom)).not.toBeNull()
    expect(store.get(playbackStatusAtom)).toBe("playing")
  })

  it("畳んでいる間のEscapeは何も畳まない。他の画面の解除を奪わない", async () => {
    const user = userEvent.setup()
    const { store } = renderBar()

    await user.click(screen.getByRole("link", { name: track.title }))
    await user.keyboard("{Escape}")

    expect(store.get(playerExpandedAtom)).toBe(false)
    expect(store.get(currentTrackAtom)).not.toBeNull()
  })

  it("閉じると展開も畳む。次に載せた番組が開いた状態で始まらない", async () => {
    const user = userEvent.setup()
    const { store } = renderBar()
    await user.click(screen.getByRole("button", { name: "再生の詳細" }))

    await user.click(
      screen.getByRole("button", { name: "再生を終了してバーを閉じる" })
    )

    expect(store.get(playerExpandedAtom)).toBe(false)
  })
})
