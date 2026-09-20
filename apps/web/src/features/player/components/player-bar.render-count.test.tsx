import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/shared/layouts/app-shell"
import {
  createTestQueryClient,
  createTestStore,
  TestProviders,
} from "@/shared/test/render"
import {
  renderCount,
  resetRenderCounts,
  watchRenders,
} from "@/shared/test/render-count"

import {
  attachAudioElementAtom,
  currentTrackAtom,
  handleTimeUpdateAtom,
  playbackDurationAtom,
  playerExpandedAtom,
} from "../atoms"
import { PlayerHost } from "./player-host"

// 実物をそのまま包んで数える。JSXのtypeは安定するので、親のメモ化による
// bailoutは包む前と同じように効く。
vi.mock("./transport-controls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transport-controls")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return {
    ...actual,
    TransportControls: watchRenders(
      "TransportControls",
      actual.TransportControls
    ),
  }
})
vi.mock("./volume-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./volume-control")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return {
    ...actual,
    VolumeControl: watchRenders("VolumeControl", actual.VolumeControl),
  }
})

vi.mock("./now-playing-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./now-playing-panel")>()
  const { watchRenders } = await import("@/shared/test/render-count")
  return {
    ...actual,
    NowPlayingPanel: watchRenders("NowPlayingPanel", actual.NowPlayingPanel),
  }
})

const WatchedShell = watchRenders("AppShell", AppShell)

const TICKS = 12

type Store = ReturnType<typeof createTestStore>

/**
 * 鳴らせる状態まで組み立てる。`<audio>`は要素側が正本なので、総時間と
 * 現在位置は要素へ直接生やす。
 */
async function startPlayback(store: Store) {
  const audio = document.querySelector("audio")
  expect(audio).not.toBeNull()
  Object.defineProperty(audio!, "duration", { configurable: true, value: 600 })
  Object.defineProperty(audio!, "currentTime", {
    configurable: true,
    value: 0,
    writable: true,
  })
  /*
    書き込みは`act`の中で行う。外で書くと、Reactはこの後の任意の時点で
    描き直しをまとめて流す。`waitFor`は目盛りが現れた時点で戻るので、
    **まだ流れていない描き直しが残ったまま**基準を数えることがある。
    それが後から届くと、位置の更新で描き直したように見えて予算が落ちる。
  */
  await act(async () => {
    store.set(currentTrackAtom, {
      episodeId: "episode-a",
      title: "今日のニュース",
      createdAt: "2026-08-19T00:00:00.000Z",
    })
    store.set(attachAudioElementAtom, audio)
    store.set(playbackDurationAtom, 600)
  })
  // バーは動的importで来る。他のpackageと並列に走ると取り込みが遅れるので、
  // 既定の1秒では足りないことがある。
  await waitFor(
    () =>
      expect(screen.getByRole("slider", { name: "再生位置" })).toBeDefined(),
    { timeout: 5_000 }
  )
  // 取り込み後に積まれた描き直しも、数え始める前に出し切る。
  await act(async () => {})
  return audio!
}

/** `TICKS`回ぶん位置を進める。保存の間引き(10秒)も跨がせる。 */
async function advance(store: Store, audio: Element) {
  for (let tick = 1; tick <= TICKS; tick += 1) {
    ;(audio as unknown as { currentTime: number }).currentTime = tick * 5
    await act(async () => {
      store.set(handleTimeUpdateAtom)
    })
  }
}

function renderApp() {
  const queryClient = createTestQueryClient()
  const store = createTestStore(queryClient)

  const rootRoute = createRootRoute({
    component: () => (
      <WatchedShell player={<PlayerHost />}>
        <Outlet />
      </WatchedShell>
    ),
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>本文</p>,
  })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([indexRoute]),
  })

  render(
    <TestProviders queryClient={queryClient} store={store}>
      <RouterProvider router={router as never} />
    </TestProviders>
  )
  return { store }
}

/**
 * 鳴っている間の描画範囲の予算。
 *
 * `timeupdate`は毎秒数回届く。位置を購読してよいのは目盛りと時刻表示だけで、
 * ナビゲーションや操作列まで巻き込むと、聴いている間ずっと画面下端と側面が
 * 描き直され続ける (docs/design.md §7.2)。目視では気づけないので、ここで
 * 数字にして固定する。
 */
describe("再生中の描画範囲", () => {
  beforeEach(() => {
    resetRenderCounts()
    localStorage.clear()
  })

  it("位置の更新でナビゲーションと操作列を描き直さない", async () => {
    const { store } = renderApp()
    await waitFor(() => expect(screen.getByText("本文")).toBeDefined())
    const audio = await startPlayback(store)

    const shellBefore = renderCount("AppShell")
    const transportBefore = renderCount("TransportControls")
    const volumeBefore = renderCount("VolumeControl")

    await advance(store, audio)

    const shell = renderCount("AppShell") - shellBefore
    const transport = renderCount("TransportControls") - transportBefore
    const volume = renderCount("VolumeControl") - volumeBefore
    expect(
      shell,
      `${TICKS}回の位置更新でAppShellが${shell}回描き直された`
    ).toBe(0)
    expect(
      transport,
      `${TICKS}回の位置更新で操作列が${transport}回描き直された`
    ).toBe(0)
    expect(volume, `${TICKS}回の位置更新で音量が${volume}回描き直された`).toBe(
      0
    )
  })

  /**
   * 展開した段は絵・題名・速度・音量を抱えるので、うっかり位置を購読すると
   * 予算が一段で壊れる。**開いたまま聴き続ける**のは普通の使い方なので、
   * 畳んでいる時と同じ範囲に収まることを別に固定する。
   */
  it("展開したままでも、位置の更新は操作列と音量へ届かない", async () => {
    const { store } = renderApp()
    await waitFor(() => expect(screen.getByText("本文")).toBeDefined())
    const audio = await startPlayback(store)

    await act(async () => {
      store.set(playerExpandedAtom, true)
    })
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "原稿と出典を読む" })
      ).toBeDefined()
    )

    const shellBefore = renderCount("AppShell")
    const transportBefore = renderCount("TransportControls")
    const volumeBefore = renderCount("VolumeControl")
    const panelBefore = renderCount("NowPlayingPanel")

    await advance(store, audio)

    const shell = renderCount("AppShell") - shellBefore
    const transport = renderCount("TransportControls") - transportBefore
    const volume = renderCount("VolumeControl") - volumeBefore
    const panel = renderCount("NowPlayingPanel") - panelBefore
    expect(
      panel,
      `展開中の${TICKS}回の位置更新で展開段が${panel}回描き直された`
    ).toBe(0)
    expect(
      shell,
      `展開中の${TICKS}回の位置更新でAppShellが${shell}回描き直された`
    ).toBe(0)
    expect(
      transport,
      `展開中の${TICKS}回の位置更新で操作列が${transport}回描き直された`
    ).toBe(0)
    expect(
      volume,
      `展開中の${TICKS}回の位置更新で音量が${volume}回描き直された`
    ).toBe(0)
  })
})
