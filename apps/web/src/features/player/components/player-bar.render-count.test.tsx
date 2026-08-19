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

const WatchedShell = watchRenders("AppShell", AppShell)

const TICKS = 12

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

    const audio = document.querySelector("audio")
    expect(audio).not.toBeNull()
    Object.defineProperty(audio!, "duration", {
      configurable: true,
      value: 600,
    })
    Object.defineProperty(audio!, "currentTime", {
      configurable: true,
      value: 0,
      writable: true,
    })
    store.set(currentTrackAtom, {
      episodeId: "episode-a",
      title: "今日のニュース",
      createdAt: "2026-08-19T00:00:00.000Z",
    })
    store.set(attachAudioElementAtom, audio)
    store.set(playbackDurationAtom, 600)
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "再生位置" })).toBeDefined()
    )

    const shellBefore = renderCount("AppShell")
    const transportBefore = renderCount("TransportControls")
    const volumeBefore = renderCount("VolumeControl")

    for (let tick = 1; tick <= TICKS; tick += 1) {
      // 保存の間引き(10秒)も跨がせる。記録の書き込みが描画を広げないことまで
      // 見る。
      ;(audio as unknown as { currentTime: number }).currentTime = tick * 5
      await act(async () => {
        store.set(handleTimeUpdateAtom)
      })
    }

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
})
