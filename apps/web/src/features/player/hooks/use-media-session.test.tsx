import { renderHook } from "@testing-library/react"
import { Provider as JotaiProvider, createStore } from "jotai"
import { act, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  attachAudioElementAtom,
  handleLoadedMetadataAtom,
  handleTimeUpdateAtom,
  pausePlaybackAtom,
  playEpisodeAtom,
  seekToAtom,
  setPlaybackRateAtom,
  type PlayerTrack,
} from "../atoms"
import { useMediaSession } from "./use-media-session"

const track: PlayerTrack = {
  episodeId: "episode-a",
  title: "今日のニュース",
  createdAt: "2026-08-19T00:00:00.000Z",
}

class FakeAudio {
  src = ""
  currentTime = 0
  duration = Number.NaN
  paused = true
  playbackRate = 1
  volume = 1
  muted = false
  readonly play = vi.fn(() => {
    this.paused = false
    return Promise.resolve()
  })
  readonly pause = vi.fn(() => {
    this.paused = true
  })
  readonly load = vi.fn()
}

function fakeSession() {
  return {
    metadata: null,
    playbackState: "none" as MediaSessionPlaybackState,
    setActionHandler: vi.fn(),
    setPositionState: vi.fn(),
  }
}

function setup() {
  const session = fakeSession()
  vi.stubGlobal("navigator", { ...navigator, mediaSession: session })
  vi.stubGlobal("MediaMetadata", class {})

  const store = createStore()
  const audio = new FakeAudio()
  store.set(attachAudioElementAtom, audio as unknown as HTMLAudioElement)

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <JotaiProvider store={store}>{children}</JotaiProvider>
  )
  renderHook(() => useMediaSession(), { wrapper })
  return { audio, session, store }
}

/** 総時間が判った状態にする。 */
function loaded(
  store: ReturnType<typeof setup>["store"],
  audio: FakeAudio,
  duration: number
) {
  audio.duration = duration
  act(() => store.set(handleLoadedMetadataAtom))
}

beforeEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("ロック画面への位置の報告", () => {
  it("総時間が判るまでは報告しない。長さの無い目盛りを出さない", () => {
    const { session, store } = setup()
    act(() => store.set(playEpisodeAtom, track))

    expect(session.setPositionState).not.toHaveBeenCalled()
  })

  it("総時間が判った時点で、長さと位置と速度を渡す", () => {
    const { audio, session, store } = setup()
    act(() => store.set(playEpisodeAtom, track))
    loaded(store, audio, 600)

    expect(session.setPositionState).toHaveBeenLastCalledWith({
      duration: 600,
      playbackRate: 1,
      position: 0,
    })
  })

  it("目盛りを動かしたら報告し直す。動かした先が反映されない状態を残さない", () => {
    const { audio, session, store } = setup()
    act(() => store.set(playEpisodeAtom, track))
    loaded(store, audio, 600)

    act(() => store.set(seekToAtom, 300))

    expect(session.setPositionState).toHaveBeenLastCalledWith({
      duration: 600,
      playbackRate: 1,
      position: 300,
    })
  })

  it("速度を変えたら報告し直す。等倍のまま進む目盛りにしない", () => {
    const { audio, session, store } = setup()
    act(() => store.set(playEpisodeAtom, track))
    loaded(store, audio, 600)

    act(() => store.set(setPlaybackRateAtom, 1.5))

    expect(session.setPositionState).toHaveBeenLastCalledWith({
      duration: 600,
      playbackRate: 1.5,
      position: 0,
    })
  })

  it("再生中の位置の進みでは報告しない。毎秒数回OSを叩かない", () => {
    const { audio, session, store } = setup()
    act(() => store.set(playEpisodeAtom, track))
    loaded(store, audio, 600)
    const before = session.setPositionState.mock.calls.length

    audio.currentTime = 5
    act(() => store.set(handleTimeUpdateAtom))
    audio.currentTime = 10
    act(() => store.set(handleTimeUpdateAtom))

    expect(session.setPositionState.mock.calls.length).toBe(before)
  })

  it("鳴っているかどうかをOSへ伝える", () => {
    const { audio, session, store } = setup()
    act(() => store.set(playEpisodeAtom, track))
    loaded(store, audio, 600)
    expect(session.playbackState).toBe("playing")

    act(() => store.set(pausePlaybackAtom))
    expect(session.playbackState).toBe("paused")
  })
})

describe("番組が載っていないとき", () => {
  it("OSへは「何も載っていない」と伝える", () => {
    const { session } = setup()

    expect(session.playbackState).toBe("none")
  })
})
