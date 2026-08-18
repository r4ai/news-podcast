import { createStore } from "jotai"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  attachAudioElementAtom,
  clearPersistedPlayback,
  currentEpisodeIdAtom,
  currentTrackAtom,
  cyclePlaybackRateAtom,
  episodeAudioUrl,
  handleEndedAtom,
  handleLoadedMetadataAtom,
  handleTimeUpdateAtom,
  isPlayingAtom,
  pausePlaybackAtom,
  playEpisodeAtom,
  playbackDurationAtom,
  playbackPositionAtom,
  playbackRateAtom,
  progressEntryAtomFamily,
  resumePlaybackAtom,
  progressMapAtom,
  seekToAtom,
  skipByAtom,
  togglePlaybackAtom,
  type PlayerTrack,
} from "./atoms"
import { listeningState } from "./model"

/**
 * jsdomの`HTMLMediaElement`は再生を実装しない (`play()`が例外になる)。
 * atomが要素へ何を指示したかだけを検証したいので、同じ形の器を置く。
 */
class FakeAudio {
  src = ""
  currentTime = 0
  duration = Number.NaN
  paused = true
  playbackRate = 1
  readonly play = vi.fn(() => {
    this.paused = false
    return Promise.resolve()
  })
  readonly pause = vi.fn(() => {
    this.paused = true
  })
  readonly load = vi.fn()
}

const track: PlayerTrack = {
  episodeId: "episode-a",
  title: "今日のニュース",
  createdAt: "2026-08-19T00:00:00.000Z",
}
const otherTrack: PlayerTrack = { ...track, episodeId: "episode-b" }

function setup() {
  const store = createStore()
  const audio = new FakeAudio()
  store.set(attachAudioElementAtom, audio as unknown as HTMLAudioElement)
  return { store, audio }
}

/** 読み込みが済んで総時間が判った状態にする。 */
function loaded(
  store: ReturnType<typeof setup>["store"],
  audio: FakeAudio,
  duration: number
) {
  audio.duration = duration
  store.set(handleLoadedMetadataAtom)
}

beforeEach(() => {
  localStorage.clear()
})

describe("episodeAudioUrl", () => {
  it("公開契約のsame-origin URLを組み立て、IDを必ず符号化する", () => {
    expect(episodeAudioUrl("a b/c")).toBe("/v1/episodes/a%20b%2Fc/audio")
  })
})

describe("playEpisodeAtom", () => {
  it("番組を載せて先頭から再生する", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)

    expect(audio.src).toBe(episodeAudioUrl(track.episodeId))
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(store.get(currentEpisodeIdAtom)).toBe(track.episodeId)
    expect(store.get(isPlayingAtom)).toBe(true)
  })

  it("聴き途中の番組は、総時間が判った時点で記録の位置へ戻す", () => {
    const { store, audio } = setup()
    store.set(progressMapAtom, {
      [track.episodeId]: { position: 120, duration: 600, updatedAt: 1 },
    })

    store.set(playEpisodeAtom, track)
    // metadataが届く前に位置を書いても効かない。要素が受け取れるのは読み込み後。
    expect(audio.currentTime).toBe(0)

    loaded(store, audio, 600)
    expect(audio.currentTime).toBe(120)
    expect(store.get(playbackDurationAtom)).toBe(600)
  })

  it("聴き終わった番組は先頭から鳴らし直す", () => {
    const { store, audio } = setup()
    store.set(progressMapAtom, {
      [track.episodeId]: { position: 600, duration: 600, updatedAt: 1 },
    })

    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    expect(audio.currentTime).toBe(0)
  })

  it("再生中の番組をもう一度指定しても、鳴っているものを止めない", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    audio.play.mockClear()

    store.set(playEpisodeAtom, track)
    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.pause).not.toHaveBeenCalled()
  })

  it("一時停止中の同じ番組は、読み込み直さずに再開する", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 90
    store.set(togglePlaybackAtom)
    audio.play.mockClear()

    store.set(playEpisodeAtom, track)
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.currentTime).toBe(90)
  })

  it("別の番組へ切り替えるとき、今の位置を記録してから差し替える", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 200
    store.set(handleTimeUpdateAtom)

    store.set(playEpisodeAtom, otherTrack)

    expect(store.get(progressMapAtom)[track.episodeId]).toMatchObject({
      position: 200,
      duration: 600,
    })
    expect(audio.src).toBe(episodeAudioUrl(otherTrack.episodeId))
    expect(store.get(playbackDurationAtom)).toBeUndefined()
    expect(store.get(playbackPositionAtom)).toBe(0)
  })

  it("保存済みの再生速度をそのまま引き継ぐ", () => {
    const { store, audio } = setup()
    store.set(playbackRateAtom, 1.5)

    store.set(playEpisodeAtom, track)
    expect(audio.playbackRate).toBe(1.5)
  })
})

describe("末尾まで鳴り終わった番組", () => {
  it("もう一度押すと先頭から鳴り直す", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 600
    store.set(handleEndedAtom)
    audio.paused = true

    store.set(playEpisodeAtom, track)
    expect(audio.currentTime).toBe(0)
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it("バーの再生ボタンからでも先頭へ戻す", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 600
    store.set(handleEndedAtom)
    audio.paused = true

    store.set(togglePlaybackAtom)
    expect(audio.currentTime).toBe(0)
  })
})

describe("togglePlaybackAtom", () => {
  it("再生中は止め、止まっていれば鳴らす", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)

    store.set(togglePlaybackAtom)
    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(store.get(isPlayingAtom)).toBe(false)

    store.set(togglePlaybackAtom)
    expect(store.get(isPlayingAtom)).toBe(true)
  })

  it("番組を載せていなければ何も起こさない", () => {
    const { store, audio } = setup()
    store.set(togglePlaybackAtom)
    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.pause).not.toHaveBeenCalled()
  })

  it("止めた時点の位置を記録する。閉じても続きから戻れる", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 42
    store.set(handleTimeUpdateAtom)

    store.set(togglePlaybackAtom)
    expect(store.get(progressMapAtom)[track.episodeId]).toMatchObject({
      position: 42,
      duration: 600,
    })
  })
})

/**
 * OSのロック画面やメディアキーから届くのは「命令」であって切り替えではない。
 * 同じ命令が二度届いても、状態が反転してはいけない。
 */
describe("resumePlaybackAtom / pausePlaybackAtom", () => {
  it("再生中にもう一度play命令が来ても止めない", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    audio.play.mockClear()

    store.set(resumePlaybackAtom)

    expect(audio.pause).not.toHaveBeenCalled()
    expect(store.get(isPlayingAtom)).toBe(true)
  })

  it("停止中にもう一度pause命令が来ても鳴らさない", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    store.set(pausePlaybackAtom)
    audio.play.mockClear()

    store.set(pausePlaybackAtom)

    expect(audio.play).not.toHaveBeenCalled()
    expect(store.get(isPlayingAtom)).toBe(false)
  })

  it("番組が載っていなければ、どちらの命令も何も起こさない", () => {
    const { store, audio } = setup()
    store.set(resumePlaybackAtom)
    store.set(pausePlaybackAtom)
    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.pause).not.toHaveBeenCalled()
  })
})

describe("seekToAtom / skipByAtom", () => {
  it("指定位置は0..総時間へ収める", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)

    store.set(seekToAtom, 900)
    expect(audio.currentTime).toBe(600)
    expect(store.get(playbackPositionAtom)).toBe(600)

    store.set(seekToAtom, -10)
    expect(audio.currentTime).toBe(0)
  })

  it("送り・戻しは今の位置を基準にする", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    store.set(seekToAtom, 100)

    store.set(skipByAtom, 30)
    expect(audio.currentTime).toBe(130)

    store.set(skipByAtom, -15)
    expect(audio.currentTime).toBe(115)
  })
})

describe("cyclePlaybackRateAtom", () => {
  it("速度を巡回させ、要素と保存値の両方へ反映する", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)

    store.set(cyclePlaybackRateAtom)
    const rate = store.get(playbackRateAtom)
    expect(rate).toBeGreaterThan(1)
    expect(audio.playbackRate).toBe(rate)
  })
})

describe("handleEndedAtom", () => {
  it("末尾まで鳴ったら再生済みとして記録する", () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 600

    store.set(handleEndedAtom)

    expect(listeningState(store.get(progressMapAtom)[track.episodeId])).toBe(
      "finished"
    )
    expect(store.get(isPlayingAtom)).toBe(false)
  })
})

describe("progressEntryAtomFamily", () => {
  it("番組ごとの記録だけを購読できる。無関係な番組の更新では動かない", () => {
    const { store } = setup()
    const entryAtom = progressEntryAtomFamily(track.episodeId)
    const seen: unknown[] = []
    const unsubscribe = store.sub(entryAtom, () =>
      seen.push(store.get(entryAtom))
    )

    store.set(progressMapAtom, {
      [otherTrack.episodeId]: { position: 5, duration: 60, updatedAt: 1 },
    })
    expect(seen).toEqual([])

    store.set(progressMapAtom, {
      [otherTrack.episodeId]: { position: 5, duration: 60, updatedAt: 1 },
      [track.episodeId]: { position: 10, duration: 60, updatedAt: 2 },
    })
    expect(seen).toEqual([{ position: 10, duration: 60, updatedAt: 2 }])
    unsubscribe()
  })
})

describe("記録の保存", () => {
  /**
   * 保存値を読むのはatomを作る瞬間の1回だけなので、「次に開いたとき」は
   * moduleごと読み直して初めて再現できる。storeを作り直すだけでは足りない。
   */
  async function reopen() {
    vi.resetModules()
    return await import("./atoms")
  }

  it("端末に残した記録は、次に開いたときに読み戻される", async () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 75
    store.set(handleTimeUpdateAtom)
    store.set(togglePlaybackAtom)

    const reopened = await reopen()
    expect(
      createStore().get(reopened.progressMapAtom)[track.episodeId]
    ).toMatchObject({ position: 75, duration: 600 })
  })

  it("前回の番組はバーへ戻るが、勝手には鳴らない", async () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 75
    store.set(handleTimeUpdateAtom)
    store.set(togglePlaybackAtom)

    const reopened = await reopen()
    const nextStore = createStore()
    const nextAudio = new FakeAudio()
    nextStore.set(
      reopened.attachAudioElementAtom,
      nextAudio as unknown as HTMLAudioElement
    )

    expect(nextStore.get(reopened.currentEpisodeIdAtom)).toBe(track.episodeId)
    expect(nextAudio.src).toBe(episodeAudioUrl(track.episodeId))
    expect(nextAudio.play).not.toHaveBeenCalled()

    nextAudio.duration = 600
    nextStore.set(reopened.handleLoadedMetadataAtom)
    expect(nextAudio.currentTime).toBe(75)
  })

  it("別のタブが載せ替えた番組を、鳴っている音とは無関係に引き継がない", async () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 100

    // 保存値の購読はatomがmountされている間だけ張られる。画面と同じ条件に
    // するため、購読を1つ立ててから別タブの書き込みを起こす。
    const unsubscribe = store.sub(currentTrackAtom, () => {})

    // 別のタブが自分のバーへ載せた番組。こちらの音は`track`のまま鳴っている。
    localStorage.setItem(
      "player.track",
      JSON.stringify({ ...otherTrack, title: "別タブの番組" })
    )
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "player.track",
        storageArea: localStorage,
      })
    )

    expect(store.get(currentEpisodeIdAtom)).toBe(track.episodeId)
    store.set(handleTimeUpdateAtom)
    expect(store.get(progressMapAtom)[otherTrack.episodeId]).toBeUndefined()
    unsubscribe()
  })

  it("壊れた保存値は無視して起動する", async () => {
    localStorage.setItem("player.progress", "{ではない")
    const reopened = await reopen()
    expect(createStore().get(reopened.progressMapAtom)).toEqual({})
  })
})

describe("clearPersistedPlayback", () => {
  it("端末に残る番組と再生履歴を捨てる", async () => {
    const { store, audio } = setup()
    store.set(playEpisodeAtom, track)
    loaded(store, audio, 600)
    audio.currentTime = 42
    store.set(handleTimeUpdateAtom)
    store.set(playbackRateAtom, 1.5)

    clearPersistedPlayback()

    expect(localStorage.getItem("player.track")).toBeNull()
    expect(localStorage.getItem("player.progress")).toBeNull()
    // 速度は個人を表さない端末の設定なので残す。
    expect(localStorage.getItem("player.rate")).not.toBeNull()

    vi.resetModules()
    const reopened = await import("./atoms")
    const next = createStore()
    expect(next.get(reopened.currentTrackAtom)).toBeNull()
    expect(next.get(reopened.progressMapAtom)).toEqual({})
  })
})
