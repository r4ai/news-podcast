import { useAtomValue, useSetAtom, useStore } from "jotai"
import { useEffect } from "react"

import {
  currentTrackAtom,
  isPlayingAtom,
  pausePlaybackAtom,
  playbackDurationAtom,
  playbackPositionAtom,
  playbackRateAtom,
  resumePlaybackAtom,
  seekGenerationAtom,
  seekToAtom,
  skipByAtom,
} from "../atoms"
import { SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS } from "../model"

/**
 * OSのロック画面・メディアキーからの操作を受ける。
 *
 * 画面を見ていない時間が長いのがpodcastなので、操作の入口はページの中だけに
 * 置かない。購読するのは載っている番組だけで、位置や再生状態は購読しない
 * (ロック画面の表示はブラウザが要素から直接読む)。
 */
export function useMediaSession() {
  const track = useAtomValue(currentTrackAtom)
  // OSから届くのは命令なので、切り替えではなく明示の再生/停止を渡す。
  // 同じ命令が二度届いても状態が反転しない。
  const resume = useSetAtom(resumePlaybackAtom)
  const pause = useSetAtom(pausePlaybackAtom)
  const skip = useSetAtom(skipByAtom)
  const seekTo = useSetAtom(seekToAtom)

  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined
    if (session === undefined || track === null) return

    if (typeof MediaMetadata !== "undefined") {
      session.metadata = new MediaMetadata({
        title: track.title,
        artist: "News Podcast",
        album: new Date(track.createdAt).toLocaleDateString("ja-JP"),
      })
    }

    const handlers: readonly [MediaSessionAction, MediaSessionActionHandler][] =
      [
        ["play", () => resume()],
        ["pause", () => pause()],
        ["seekbackward", () => skip(-SKIP_BACK_SECONDS)],
        ["seekforward", () => skip(SKIP_FORWARD_SECONDS)],
        [
          "seekto",
          (details) => {
            if (details.seekTime !== undefined) seekTo(details.seekTime)
          },
        ],
      ]
    for (const [action, handler] of handlers) {
      // 端末が対応しない操作は登録そのものが失敗する。1つの失敗で残りの
      // 登録まで止めない。
      try {
        session.setActionHandler(action, handler)
      } catch {
        // 未対応の操作は何もしない。
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null)
        } catch {
          // 未対応の操作は何もしない。
        }
      }
      session.metadata = null
    }
  }, [track, resume, pause, skip, seekTo])

  usePlaybackPositionState(track !== null)
}

/**
 * ロック画面の目盛りへ「長さ・位置・速度」を渡す。
 *
 * これを渡さないと、OS側の目盛りは長さを持たないまま止まって見え、
 * 掴んで飛ばす操作も出ない。
 *
 * 報告は**まばらな出来事のときだけ**行う。OSは最後に報告した位置を実時間で
 * 外挿するので、毎秒数回叩く必要はない。逆に位置(`playbackPositionAtom`)を
 * 購読すると、鳴っている間ずっとこのhookを抱える`PlayerHost`が描き直され、
 * `<audio>`と再生バー全体が巻き込まれる (docs/design.md §7.2)。
 *
 * 外挿が狂うのは「飛ばした」「速度を変えた」ときだけなので、その2つを
 * それぞれまばらな値として購読し、位置は報告する瞬間に非購読で読む。
 */
function usePlaybackPositionState(hasTrack: boolean) {
  const store = useStore()
  const duration = useAtomValue(playbackDurationAtom)
  const rate = useAtomValue(playbackRateAtom)
  const playing = useAtomValue(isPlayingAtom)
  const seekGeneration = useAtomValue(seekGenerationAtom)

  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined
    if (session === undefined) return

    // 何も載っていない状態は「止めている」ではない。`paused`にすると、
    // OS側に押せる再生ボタンが出てしまう。
    session.playbackState = !hasTrack ? "none" : playing ? "playing" : "paused"

    // 総時間が判るまでは渡さない。長さの無い目盛りは掴めず、値によっては
    // 例外になる。
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
      return
    }
    try {
      session.setPositionState?.({
        duration,
        playbackRate: rate,
        // 位置は報告する瞬間の値でよい。購読すると毎秒数回ここが動く。
        position: Math.min(store.get(playbackPositionAtom), duration),
      })
    } catch {
      // 端末が対応しない、または値を受け付けない場合は何もしない。
    }
  }, [store, duration, rate, playing, seekGeneration, hasTrack])

  // バーを畳んだら目盛りも消す。前の番組の長さが残ったままにしない。
  useEffect(() => {
    return () => {
      const session = navigator.mediaSession as MediaSession | undefined
      if (session === undefined) return
      session.playbackState = "none"
      try {
        session.setPositionState?.()
      } catch {
        // 未対応の端末では何もしない。
      }
    }
  }, [])
}
