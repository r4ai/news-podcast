import { useSetAtom } from "jotai"

import {
  attachAudioElementAtom,
  handleEndedAtom,
  handleErrorAtom,
  handleLoadedMetadataAtom,
  handlePauseAtom,
  handlePlayAtom,
  handlePlayingAtom,
  handleTimeUpdateAtom,
  handleWaitingAtom,
} from "../atoms"
import { useMediaSession } from "../hooks/use-media-session"
import { PlayerBar } from "./player-bar"

/**
 * 音を出す唯一の場所。
 *
 * `AppShell`の中、`Outlet`の外に立てる。routeの中に置くと、ページを移った
 * 瞬間に`<audio>`ごと外れて音が切れる。ここに1つだけ持つことで、再生は
 * 画面遷移から独立する (ADR-0064)。
 *
 * このcomponent自身は何も購読しない。要素が起こした出来事をatomへ渡すだけで、
 * 描き直しはそれぞれの値を実際に描くcomponentの中で止まる。
 */
export function PlayerHost() {
  const attach = useSetAtom(attachAudioElementAtom)
  const onLoadedMetadata = useSetAtom(handleLoadedMetadataAtom)
  const onTimeUpdate = useSetAtom(handleTimeUpdateAtom)
  const onPlay = useSetAtom(handlePlayAtom)
  const onPause = useSetAtom(handlePauseAtom)
  const onEnded = useSetAtom(handleEndedAtom)
  const onError = useSetAtom(handleErrorAtom)
  // 「押したのに聞こえない」を待ちと失敗に分けるための2つ。`waiting`は
  // データ切れ、`playing`は実際に音が出た合図。
  const onWaiting = useSetAtom(handleWaitingAtom)
  const onPlaying = useSetAtom(handlePlayingAtom)

  useMediaSession()

  return (
    <>
      {/*
        操作は再生バーが持つので、要素自身のcontrolsは出さない。
        `preload="metadata"`は総時間 (契約に無い) を得るための最小限の先読み。
      */}
      <audio
        className="hidden"
        onEnded={() => onEnded()}
        onError={() => onError()}
        onLoadedMetadata={() => onLoadedMetadata()}
        onPause={() => onPause()}
        onPlay={() => onPlay()}
        onPlaying={() => onPlaying()}
        onTimeUpdate={() => onTimeUpdate()}
        onWaiting={() => onWaiting()}
        preload="metadata"
        ref={(element) => {
          attach(element)
        }}
      />
      <PlayerBar />
    </>
  )
}
