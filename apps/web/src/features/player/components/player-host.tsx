import { useAtomValue, useSetAtom } from "jotai"
import { lazy, Suspense } from "react"

import {
  attachAudioElementAtom,
  currentTrackAtom,
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

/**
 * バーの一式 (目盛り・操作列・速度・音量) は、番組が載って初めて要る。
 *
 * 速度の選択と音量はpopupを組む部品を連れてくるので、静的に繋ぐと初回表示の
 * 資産に丸ごと乗る。しかし初めて開いた利用者のバーは空で、押せるものが1つも
 * ない。載っている番組があるかどうかで分ける。
 */
const PlayerBar = lazy(async () => ({
  default: (await import("./player-bar")).PlayerBar,
}))

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
  // 載っているかどうかだけを見る。中身が変わっても`<audio>`は張り替えない。
  const hasTrack = useAtomValue(currentTrackAtom) !== null
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
      {/*
        取りに行っている間は何も出さない。空の枠を先に置くと、本文の末尾に
        バー1本分の余白が空いたまま何も鳴らない状態になる。
      */}
      {hasTrack ? (
        <Suspense fallback={null}>
          <PlayerBar />
        </Suspense>
      ) : null}
    </>
  )
}
