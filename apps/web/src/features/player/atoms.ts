import { atom } from "jotai"
import { atomFamily, atomWithStorage, selectAtom } from "jotai/utils"

import { recordBrowserEvent } from "@/shared/observability/events"
import {
  clampTime,
  FINISH_TAIL_SECONDS,
  nextPlaybackRate,
  parseProgressMap,
  parsePlayerTrack,
  recordProgress,
  resumePosition,
  seekBy,
  type PlaybackEntry,
  type PlayerTrack,
  type ProgressMap,
} from "./model"

export type { PlayerTrack } from "./model"

/** 公開音声契約はsame-originの `GET /v1/episodes/{id}/audio` (ADR-0055)。 */
export function episodeAudioUrl(episodeId: string): string {
  return `/v1/episodes/${encodeURIComponent(episodeId)}/audio`
}

/**
 * 端末に残す値の保存規則。
 *
 * 保存領域には別のタブや過去の版が書いた値も入る。読める形だけを通し、
 * 読めなければ初期値へ落とす。
 *
 * `crossTab`は「別タブの書き込みを取り込むか」。取り込んでよいのは、その値が
 * 単独で意味を持つもの (再生記録・速度) だけ。**今どの番組を鳴らしているか**は
 * このタブの`<audio>`と対で意味を持つので取り込まない。取り込むと、鳴っている
 * 音は前の番組のまま見出しだけが差し替わり、その位置を別の番組の記録として
 * 保存してしまう。
 */
function localStorageWith<Value>(
  parse: (raw: unknown) => Value | undefined,
  { crossTab = true }: { readonly crossTab?: boolean } = {}
) {
  const read = (key: string, initialValue: Value): Value => {
    try {
      const stored = localStorage.getItem(key)
      if (stored === null) return initialValue
      return parse(JSON.parse(stored)) ?? initialValue
    } catch {
      return initialValue
    }
  }
  return {
    getItem: read,
    setItem: (key: string, value: Value) =>
      localStorage.setItem(key, JSON.stringify(value)),
    removeItem: (key: string) => localStorage.removeItem(key),
    subscribe: (
      key: string,
      callback: (value: Value) => void,
      initialValue: Value
    ) => {
      if (!crossTab) return () => {}
      const handle = (event: StorageEvent) => {
        if (event.storageArea !== localStorage || event.key !== key) return
        callback(read(key, initialValue))
      }
      window.addEventListener("storage", handle)
      return () => window.removeEventListener("storage", handle)
    },
  }
}

const PROGRESS_STORAGE_KEY = "player.progress"
const TRACK_STORAGE_KEY = "player.track"
const RATE_STORAGE_KEY = "player.rate"

/**
 * 番組ごとの再生位置。**リロードを跨いで続きから聴ける**ようにするための
 * 唯一の記録で、一覧の「聴き途中／再生済み」も同じ値から導く。
 */
export const progressMapAtom = atomWithStorage<ProgressMap>(
  PROGRESS_STORAGE_KEY,
  {},
  localStorageWith(parseProgressMap),
  { getOnInit: true }
)

/**
 * バーに載っている番組。閉じるまで残るので、リロード後も同じ番組が並ぶ。
 * 音声そのものは復元しない (自動再生はブラウザが止める)。押せば続きから鳴る。
 */
export const currentTrackAtom = atomWithStorage<PlayerTrack | null>(
  TRACK_STORAGE_KEY,
  null,
  localStorageWith((raw) => parsePlayerTrack(raw) ?? null, {
    crossTab: false,
  }),
  { getOnInit: true }
)

export const playbackRateAtom = atomWithStorage<number>(
  RATE_STORAGE_KEY,
  1,
  localStorageWith((raw) => (typeof raw === "number" ? raw : undefined)),
  { getOnInit: true }
)

/**
 * 端末に残る「誰が何をどこまで聴いたか」を捨てる。
 *
 * 保存領域はorigin単位なので、同じブラウザで別の利用者がログインすると、
 * 前の利用者の番組名と再生履歴がそのまま復元されてしまう。認証が切れて
 * ログイン画面に着いた時点で捨てる。再生速度は個人を表さない端末の設定
 * なので残す。
 */
export function clearPersistedPlayback(): void {
  localStorage.removeItem(TRACK_STORAGE_KEY)
  localStorage.removeItem(PROGRESS_STORAGE_KEY)
}

export type PlaybackStatus = "idle" | "playing" | "paused" | "error"

export const playbackStatusAtom = atom<PlaybackStatus>("idle")

/** 現在位置。`timeupdate`で毎秒数回動くので、購読はバーの目盛りだけに閉じる。 */
export const playbackPositionAtom = atom(0)

/** 総時間。契約には無く、`loadedmetadata`が届くまで判らない。 */
export const playbackDurationAtom = atom<number | undefined>(undefined)

/**
 * 読み込みが済むまで持ち越す再開位置。
 * metadataが届く前に`currentTime`へ書いても要素は受け取らない。
 */
const pendingSeekAtom = atom<number | null>(null)

export const isPlayingAtom = atom(
  (get) => get(playbackStatusAtom) === "playing"
)

/** 行が購読するのはIDだけ。位置が動いても一覧は描き直されない。 */
export const currentEpisodeIdAtom = atom(
  (get) => get(currentTrackAtom)?.episodeId
)

/**
 * その番組が今鳴っているか。
 *
 * 一覧の行はこれを購読する。`isPlayingAtom`を直に購読すると、1回の
 * 再生/停止で全ての行が描き直される。
 */
export const episodePlayingAtomFamily = atomFamily((episodeId: string) =>
  atom((get) => get(currentEpisodeIdAtom) === episodeId && get(isPlayingAtom))
)

/** 番組1件分の再生記録。無関係な番組の記録が動いても購読は起きない。 */
export const progressEntryAtomFamily = atomFamily((episodeId: string) =>
  selectAtom(
    progressMapAtom,
    (map): PlaybackEntry | undefined => map[episodeId]
  )
)

/**
 * `<audio>`そのもの。
 *
 * 再生位置・再生中かどうかの正本は要素側にあり、atomはその写しを配るだけ。
 * 逆向き (atomを正本にして要素へ同期する) にすると、OSのメディアキーや
 * ロック画面から要素が直接動かされたときに二重の真実ができる。
 */
const audioElementAtom = atom<HTMLAudioElement | null>(null)

export const attachAudioElementAtom = atom(
  null,
  (get, set, element: HTMLAudioElement | null) => {
    set(audioElementAtom, element)
    if (element === null) return
    element.playbackRate = get(playbackRateAtom)

    // リロード直後。前回の番組をバーへ戻し、押せば続きから鳴る状態にする。
    const track = get(currentTrackAtom)
    if (track === null || element.src !== "") return
    const from = resumePosition(get(progressMapAtom)[track.episodeId])
    element.src = episodeAudioUrl(track.episodeId)
    set(pendingSeekAtom, from)
    set(playbackPositionAtom, from)
  }
)

/** 今の位置を記録へ写す。書き込みは端末の保存領域まで届く。 */
const saveProgressAtom = atom(null, (get, set, override?: PlaybackEntry) => {
  const track = get(currentTrackAtom)
  const element = get(audioElementAtom)
  if (track === null || element === null) return
  const duration = Number.isFinite(element.duration) ? element.duration : 0
  const entry = override ?? {
    position: element.currentTime,
    duration,
    updatedAt: Date.now(),
  }
  set(
    progressMapAtom,
    recordProgress(get(progressMapAtom), track.episodeId, entry)
  )
})

/** 保存の間引き幅。毎フレーム書くと保存領域への書き込みが止まらない。 */
const SAVE_INTERVAL_SECONDS = 10

/**
 * 鳴り終わった位置から再生し直すと、何も鳴らないまま終わる。
 * 末尾に居るなら先頭へ戻してから鳴らす。
 */
function rewindIfFinished(element: HTMLAudioElement): void {
  const duration = element.duration
  const atEnd =
    element.ended ||
    (Number.isFinite(duration) &&
      duration > 0 &&
      element.currentTime >= duration - FINISH_TAIL_SECONDS)
  if (atEnd) element.currentTime = 0
}

export const playEpisodeAtom = atom(null, (get, set, track: PlayerTrack) => {
  const element = get(audioElementAtom)
  if (element === null) return

  const current = get(currentTrackAtom)
  if (current?.episodeId === track.episodeId) {
    // 同じ番組。鳴っていれば触らない。止まっていれば読み込み直さず続ける。
    if (element.paused) {
      rewindIfFinished(element)
      set(playbackPositionAtom, element.currentTime)
      set(playbackStatusAtom, "playing")
      void element.play()
    }
    return
  }

  // 差し替える前に、今の番組の位置を残す。
  if (current !== null) set(saveProgressAtom)

  const from = resumePosition(get(progressMapAtom)[track.episodeId])
  set(currentTrackAtom, track)
  set(playbackDurationAtom, undefined)
  set(playbackPositionAtom, from)
  set(pendingSeekAtom, from)
  set(playbackStatusAtom, "playing")
  element.src = episodeAudioUrl(track.episodeId)
  element.playbackRate = get(playbackRateAtom)
  void element.play()
  recordBrowserEvent("audio.started", { "episode.id": track.episodeId })
})

/**
 * 鳴らす。既に鳴っていれば何もしない。
 *
 * OSのロック画面やメディアキーから届くのは「命令」であって切り替えではない。
 * 同じ命令が二度届いても状態が反転しないよう、再生と停止は別々に持つ。
 */
export const resumePlaybackAtom = atom(null, (get, set) => {
  const element = get(audioElementAtom)
  if (element === null || get(currentTrackAtom) === null) return
  if (!element.paused) return
  rewindIfFinished(element)
  set(playbackPositionAtom, element.currentTime)
  set(playbackStatusAtom, "playing")
  void element.play()
})

/** 止める。既に止まっていれば何もしない。 */
export const pausePlaybackAtom = atom(null, (get, set) => {
  const element = get(audioElementAtom)
  if (element === null || get(currentTrackAtom) === null) return
  if (element.paused) return
  element.pause()
  set(playbackStatusAtom, "paused")
  set(saveProgressAtom)
})

/** 画面のボタン。今の状態の反対へ倒す。 */
export const togglePlaybackAtom = atom(null, (get, set) => {
  const element = get(audioElementAtom)
  if (element === null) return
  set(element.paused ? resumePlaybackAtom : pausePlaybackAtom)
})

export const seekToAtom = atom(null, (get, set, seconds: number) => {
  const element = get(audioElementAtom)
  if (element === null) return
  const next = clampTime(seconds, get(playbackDurationAtom))
  element.currentTime = next
  set(playbackPositionAtom, next)
})

export const skipByAtom = atom(null, (get, set, offset: number) => {
  const element = get(audioElementAtom)
  if (element === null) return
  const next = seekBy(element.currentTime, offset, get(playbackDurationAtom))
  element.currentTime = next
  set(playbackPositionAtom, next)
})

export const cyclePlaybackRateAtom = atom(null, (get, set) => {
  const rate = nextPlaybackRate(get(playbackRateAtom))
  set(playbackRateAtom, rate)
  const element = get(audioElementAtom)
  if (element !== null) element.playbackRate = rate
})

/** バーから降ろす。鳴っているものは止め、位置は記録に残す。 */
export const closePlayerAtom = atom(null, (get, set) => {
  const element = get(audioElementAtom)
  if (element !== null && !element.paused) element.pause()
  set(saveProgressAtom)
  set(currentTrackAtom, null)
  set(playbackStatusAtom, "idle")
  set(playbackPositionAtom, 0)
  set(playbackDurationAtom, undefined)
  if (element !== null) element.removeAttribute("src")
})

export const handleLoadedMetadataAtom = atom(null, (get, set) => {
  const element = get(audioElementAtom)
  if (element === null) return
  set(
    playbackDurationAtom,
    Number.isFinite(element.duration) ? element.duration : undefined
  )
  const pending = get(pendingSeekAtom)
  if (pending === null) return
  set(pendingSeekAtom, null)
  const next = clampTime(pending, get(playbackDurationAtom))
  element.currentTime = next
  set(playbackPositionAtom, next)
})

export const handleTimeUpdateAtom = atom(null, (get, set) => {
  const element = get(audioElementAtom)
  const track = get(currentTrackAtom)
  if (element === null || track === null) return
  set(playbackPositionAtom, element.currentTime)

  // 聴いている最中も一定の間隔で残す。タブが不意に落ちても続きから戻れる。
  const saved = get(progressMapAtom)[track.episodeId]
  const moved = Math.abs(element.currentTime - (saved?.position ?? 0))
  if (moved >= SAVE_INTERVAL_SECONDS) set(saveProgressAtom)
})

export const handlePlayAtom = atom(null, (_get, set) => {
  set(playbackStatusAtom, "playing")
})

export const handlePauseAtom = atom(null, (_get, set) => {
  set(playbackStatusAtom, "paused")
  set(saveProgressAtom)
})

export const handleEndedAtom = atom(null, (get, set) => {
  const element = get(audioElementAtom)
  const duration = get(playbackDurationAtom) ?? element?.duration ?? 0
  set(playbackStatusAtom, "paused")
  set(saveProgressAtom, {
    position: Number.isFinite(duration) ? duration : 0,
    duration: Number.isFinite(duration) ? duration : 0,
    updatedAt: Date.now(),
  })
  recordBrowserEvent("audio.completed")
})

export const handleErrorAtom = atom(null, (_get, set) => {
  set(playbackStatusAtom, "error")
  recordBrowserEvent("audio.error")
})
