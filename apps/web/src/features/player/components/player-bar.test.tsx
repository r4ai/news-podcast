import { act } from "react"
import { render, screen, within } from "@testing-library/react"
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

/**
 * 幅の判定を差し替える。開いた中身の**器**は幅で変わり(板がその場で伸びるか、
 * 下端からDrawerが立ち上がるか)、CSSでは選べないのでJSが幅を読む。jsdomは
 * `matchMedia`を実装しないので、ここで答えを決める。
 */
function setWide(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function renderBar(
  patch: {
    readonly playing?: boolean
    readonly status?: PlaybackStatus
    readonly wide?: boolean
  } = {}
) {
  setWide(patch.wide ?? false)
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
    setWide(false)
    render(
      <TestProviders queryClient={queryClient}>
        <PlayerBar />
      </TestProviders>
    )
    expect(screen.queryByRole("region", { name: "再生中の番組" })).toBeNull()
  })

  it("smからは経過と残りを目盛りの両端へ置く", () => {
    renderBar()
    const rail = screen.getByRole("slider", { name: "再生位置" }).parentElement
      ?.parentElement
    expect(rail?.textContent).toBe("2:00-8:00")
  })

  it("狭い幅では、同じ行が経過と総時間を文字で示す", () => {
    const { container } = renderBar()
    expect(container.querySelector("p.sm\\:hidden")?.textContent).toBe(
      "2:00 / 10:00"
    )
  })

  it("目盛りは板の上端の縁いっぱいに置く。狭い幅で数十pxまで縮まない", () => {
    renderBar()
    const scrubber = screen.getByRole("slider", { name: "再生位置" })
    const edge = scrubber.parentElement?.parentElement
    expect(edge?.className).toContain("inset-x-0")
    expect(edge?.className).toContain("top-0")
  })

  /*
    帯は板の縁の曲がりまで辿って消えるが、**掴み代は切らない**。見えるものだけ
    を`clip-path`で切り、当たり判定を持つ`input`は全幅のまま残す。切ってしまう
    と、角の位置を押しても先頭・末尾へ着かない。
  */
  it("見えるものだけを板の形に切り、掴み代は全幅のまま残す", () => {
    renderBar()
    const scrubber = screen.getByRole("slider", { name: "再生位置" })
    const box = scrubber.parentElement
    expect(box?.className).not.toContain("clip-path")
    const painted = box?.querySelector("div")
    expect(painted?.className).toContain("clip-path:inset")
  })

  it("UAのつまみは幅を持たない。塗りの先端と掴んだ位置がずれない", () => {
    renderBar()
    const scrubber = screen.getByRole("slider", { name: "再生位置" })
    /*
      幅を持たせると、UAはつまみが端から食み出さないよう`幅 − つまみ幅`の
      範囲でしか動かさない。塗りは全幅に対する`scaleX`なので、両端で
      「つまみ幅の半分」ずれる(実測: 14pxのつまみで7px)。
    */
    expect(scrubber.className).toContain("[&::-webkit-slider-thumb]:w-0")
    expect(scrubber.className).toContain("[&::-moz-range-thumb]:w-0")
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

/**
 * 開き方。
 *
 * 開くための専用ボタンは置かない。板の押せない場所はどこでも開き、キーボード
 * からは題名がその役を兼ねる。常設の行は幅が足りず、ボタンを1つ足すだけで
 * 題名が数文字ぶん削れる。
 */
describe("PlayerBar の開閉", () => {
  beforeEach(() => localStorage.clear())

  it("初めは畳んでいる。聴いていない間まで本文を削らない", () => {
    renderBar()
    expect(
      screen
        .getByRole("button", { name: track.title })
        .getAttribute("aria-expanded")
    ).toBe("false")
    expect(screen.queryByRole("link", { name: "原稿と出典を読む" })).toBeNull()
  })

  it("題名を押すと開く。キーボードだけでも辿り着ける", async () => {
    const user = userEvent.setup()
    const { store } = renderBar()

    await user.click(screen.getByRole("button", { name: track.title }))

    expect(store.get(playerExpandedAtom)).toBe(true)
    expect(screen.getByRole("link", { name: "原稿と出典を読む" })).toBeDefined()
  })

  it("板の押せない場所を押しても開く", async () => {
    const user = userEvent.setup()
    const { container, store } = renderBar()

    // 絵は押せるものではない。ここを押しても開く。
    const artwork = container.querySelector('[aria-hidden="true"].rounded-xl')
    expect(artwork).not.toBeNull()
    await user.click(artwork as Element)

    expect(store.get(playerExpandedAtom)).toBe(true)
  })

  it("押せるものを押したときは開かない。操作が二重に起きない", async () => {
    const user = userEvent.setup()
    const { store } = renderBar()

    await user.click(screen.getByRole("button", { name: "再生" }))

    expect(store.get(playerExpandedAtom)).toBe(false)
  })

  it("狭い幅では、下端から立ち上がるDrawerで開く", async () => {
    const user = userEvent.setup()
    renderBar({ wide: false })

    await user.click(screen.getByRole("button", { name: track.title }))

    const drawer = screen.getByRole("dialog")
    // Drawerは操作列も連れて出る。板は背面へ退いて触れなくなるので、
    // 押し所がここにしか無い。
    expect(within(drawer).getByRole("button", { name: "再生" })).toBeDefined()
    expect(
      within(drawer).getByRole("slider", { name: "再生位置" })
    ).toBeDefined()
  })

  it("広い幅では、板がその場で伸びる。画面を覆わない", async () => {
    const user = userEvent.setup()
    renderBar({ wide: true })

    await user.click(screen.getByRole("button", { name: track.title }))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("link", { name: "原稿と出典を読む" })).toBeDefined()
  })

  it("開いても題名と目盛りは1つずつ。器をまたいで重ならない", async () => {
    const user = userEvent.setup()
    renderBar({ wide: true })

    await user.click(screen.getByRole("button", { name: track.title }))

    expect(screen.getAllByRole("slider", { name: "再生位置" })).toHaveLength(1)
  })

  it("開いた先の目盛りも、掴んだ位置へ飛ばせる", async () => {
    const user = userEvent.setup()
    const { audio } = renderBar({ wide: true })
    await user.click(screen.getByRole("button", { name: track.title }))

    const scrubber = screen.getByRole("slider", { name: "再生位置" })
    Object.defineProperty(scrubber, "value", { value: "420", writable: true })
    scrubber.dispatchEvent(new Event("change", { bubbles: true }))

    expect(audio.currentTime).toBe(420)
  })

  it("開いた先で速度を選べる。狙った速度へ1操作で着く", async () => {
    const user = userEvent.setup()
    const { audio, store } = renderBar({ wide: true })
    await user.click(screen.getByRole("button", { name: track.title }))

    await user.click(screen.getByRole("combobox", { name: /再生速度/ }))
    await user.click(await screen.findByRole("option", { name: "1.5×" }))

    expect(store.get(playbackRateAtom)).toBe(1.5)
    expect(audio.playbackRate).toBe(1.5)
  })

  it("開いた先の音量は、さらに開く操作を挟まずに触れる", async () => {
    const user = userEvent.setup()
    const { audio, store } = renderBar({ wide: true })
    await user.click(screen.getByRole("button", { name: track.title }))

    const volume = screen.getByRole("slider", { name: "音量" })
    Object.defineProperty(volume, "value", { value: "0.4", writable: true })
    volume.dispatchEvent(new Event("change", { bubbles: true }))

    expect(store.get(volumeAtom)).toBe(0.4)
    expect(audio.volume).toBe(0.4)
  })

  it("消音は押して切り替える。音量の記憶は残る", async () => {
    const user = userEvent.setup()
    const { audio, store } = renderBar({ wide: true })
    await user.click(screen.getByRole("button", { name: track.title }))

    await user.click(screen.getByRole("button", { name: "消音にする" }))

    expect(store.get(mutedAtom)).toBe(true)
    expect(audio.muted).toBe(true)
    expect(store.get(volumeAtom)).toBe(1)
  })

  /*
    開いた中身は畳んだ瞬間に消える。focusを持ったまま消えると、行き先を失った
    focusは`body`へ落ち、キーボードだけで使う利用者はページの先頭から辿り直す
    ことになる。消えない題名へ先に移す。
  */
  it("中身からEscapeで畳んでも、focusは題名に残る", async () => {
    const user = userEvent.setup()
    renderBar({ wide: true })
    const title = screen.getByRole("button", { name: track.title })
    await user.click(title)

    const volume = screen.getByRole("slider", { name: "音量" })
    volume.focus()
    expect(document.activeElement).toBe(volume)

    await user.keyboard("{Escape}")

    expect(document.activeElement).toBe(title)
  })

  it("Escapeは畳むだけ。音は止めない", async () => {
    const user = userEvent.setup()
    const { store } = renderBar({ playing: true, wide: true })
    await user.click(screen.getByRole("button", { name: track.title }))

    await user.keyboard("{Escape}")

    expect(store.get(playerExpandedAtom)).toBe(false)
    expect(store.get(currentTrackAtom)).not.toBeNull()
    expect(store.get(playbackStatusAtom)).toBe("playing")
  })

  it("閉じると展開も畳む。次に載せた番組が開いた状態で始まらない", async () => {
    const user = userEvent.setup()
    const { store } = renderBar({ wide: true })
    await user.click(screen.getByRole("button", { name: track.title }))

    await user.click(
      screen.getByRole("button", { name: "再生を終了してバーを閉じる" })
    )

    expect(store.get(playerExpandedAtom)).toBe(false)
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
    expect(screen.getAllByText("読み込み中…").length).toBeGreaterThan(0)

    await act(async () => store.set(handlePlayingAtom))
    expect(screen.queryAllByText("読み込み中…")).toHaveLength(0)
  })

  /*
    待ちの表示と時刻は、**同じ1行を入れ替える**。

    並べて置くと、320pxでは題名の列(102px)へ137px入れることになり、再生
    ボタンへ重なる。待っている間は位置も動かないので、入れ替えて構わない。
  */
  it("待っている間は、時刻ではなく理由だけを出す。再生ボタンへ重ならない", async () => {
    const { container, store } = renderBar({ playing: true })
    const narrowLine = () => container.querySelector("p.sm\\:hidden")
    expect(narrowLine()?.textContent).toBe("2:00 / 10:00")

    await act(async () => store.set(handleWaitingAtom))

    expect(narrowLine()?.textContent).toBe("読み込み中…")
    // 待ちは「押したのに聞こえない」の最中に起きる。読み上げへも届ける。
    expect(narrowLine()?.getAttribute("aria-live")).toBe("polite")

    await act(async () => store.set(handlePlayingAtom))
    expect(narrowLine()?.textContent).toBe("2:00 / 10:00")
  })

  /*
    失敗の行は板の高さそのものを変える。`AppShell`が確保を厚くしないと、
    板より手前に浮く回線切れの案内がちょうどこの行へ重なり、理由もやり直す
    道も読めなくなる(実測: 390pxで通知615..644が失敗バナー606..651を覆う)。
  */
  it("失敗の行は、確保する高さを増やす印を持つ", () => {
    renderBar({ status: "error" })
    expect(screen.getByRole("alert").getAttribute("data-slot")).toBe(
      "player-error"
    )
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
