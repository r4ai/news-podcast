import { Link } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import { X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { closePlayerAtom, currentTrackAtom, type PlayerTrack } from "../atoms"
import { PlaybackNotice } from "./playback-notice"
import { PlaybackRateSelect } from "./playback-rate-select"
import { PlaybackScrubber, PlaybackTimeReadout } from "./playback-scrubber"
import { TransportControls } from "./transport-controls"
import { VolumeControl } from "./volume-control"

/**
 * 画面下端に居座る再生バー。
 *
 * routeの外 (`AppShell`) に立っているので、ページを移っても音は途切れない。
 * ここが購読するのは「今どの番組が載っているか」だけで、位置・再生状態・
 * 速度・音量はそれぞれを描くcomponentが自分で購読する。
 *
 * 段は2つ。上段が「何を、どこまで」、下段が「どう鳴らすか」。1段に詰めると、
 * 狭い幅では題名か操作のどちらかが潰れる。
 */
export function PlayerBar() {
  const track = useAtomValue(currentTrackAtom)
  if (track === null) return null

  return (
    <div
      aria-label="再生中の番組"
      className={
        // モバイルは下部ナビの上へ載せる。ナビの実高は`--app-nav-h`が持つ。
        // 背景は透かさない。目盛りが毎秒数回動く面をbackdrop-filterの下に
        // 置くと、その都度この帯ごと再描画される。
        "fixed inset-x-0 bottom-[var(--app-nav-h)] z-30 border-t bg-background md:bottom-0"
      }
      // `AppShell`がこの印を`:has()`で見て、本文末尾の余白を確保する。
      data-slot="player-bar"
      role="region"
    >
      {/* 目盛りはこの箱の上端の縁に重なるので、位置の基準をここに置く。 */}
      <PlaybackScrubber />

      <div className="mx-auto flex flex-col gap-1 px-3 pt-2 pb-1.5 md:pr-6 md:pl-[15rem]">
        {/* 上段: 何を鳴らしていて、どこまで来たか。 */}
        <div className="flex items-center gap-3">
          <TrackSummary track={track} />
          <PlaybackTimeReadout />
          <CloseButton />
        </div>

        {/* 下段: どう鳴らすか。 */}
        <div className="flex items-center gap-2">
          <TransportControls />
          {/*
            音が出ていない理由は操作の隣に置く。上段 (題名) へ置くと、題名を
            押し出して読めなくなる。
          */}
          <PlaybackNotice />
          <div className="ml-auto flex items-center gap-2">
            <PlaybackRateSelect />
            <VolumeControl />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 何を鳴らしているか。題名はライブラリの該当番組へのリンクにする。
 * 「今聴いているものの原稿を見たい」が最短で叶う。
 */
function TrackSummary({ track }: { readonly track: PlayerTrack }) {
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-2">
      <Link
        className="truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        search={{ episode: track.episodeId }}
        title={track.title}
        to="/library"
      >
        {track.title}
      </Link>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {new Date(track.createdAt).toLocaleString("ja-JP")}
      </span>
    </div>
  )
}

function CloseButton() {
  const close = useSetAtom(closePlayerAtom)

  return (
    <Button
      aria-label="再生を終了してバーを閉じる"
      className="size-8 shrink-0"
      onClick={() => close()}
      size="icon"
      variant="ghost"
    >
      <X aria-hidden="true" />
    </Button>
  )
}
