import { useAtomValue, useSetAtom } from "jotai"
import { useEffect } from "react"

import {
  currentTrackAtom,
  pausePlaybackAtom,
  resumePlaybackAtom,
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
}
