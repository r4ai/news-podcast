import { Link } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import { X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import {
  closePlayerAtom,
  currentTrackAtom,
  cyclePlaybackRateAtom,
  playbackRateAtom,
  type PlayerTrack,
} from "../atoms"
import { PlaybackScrubber } from "./playback-scrubber"
import { TransportControls } from "./transport-controls"

/**
 * 画面下端に居座る再生バー。
 *
 * routeの外 (`AppShell`) に立っているので、ページを移っても音は途切れない。
 * ここが購読するのは「今どの番組が載っているか」だけで、位置と再生状態は
 * それぞれ目盛りと操作ボタンが自分で購読する。
 */
export function PlayerBar() {
  const track = useAtomValue(currentTrackAtom)
  if (track === null) return null

  return (
    <div
      aria-label="再生中の番組"
      // モバイルは下部ナビの上へ載せる。ナビの実高は`--app-nav-h`が持つ。
      className="fixed inset-x-0 bottom-[var(--app-nav-h)] z-30 border-t bg-background/95 backdrop-blur md:bottom-0"
      // `AppShell`がこの印を`:has()`で見て、本文末尾の余白を確保する。
      data-slot="player-bar"
      role="region"
    >
      {/* 目盛りは狭い幅でこの箱の上端へ重なるので、位置の基準をここに置く。 */}
      <div className="relative mx-auto flex items-center gap-2 px-2 py-1.5 md:gap-4 md:py-2 md:pr-6 md:pl-[15rem]">
        <TrackSummary track={track} />
        <TransportControls />
        <PlaybackScrubber className="md:max-w-2xl md:flex-1" />
        <PlaybackRateButton />
        <CloseButton />
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
    <div className="flex min-w-0 flex-1 flex-col md:w-56 md:flex-none">
      <Link
        className="truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        search={{ episode: track.episodeId }}
        title={track.title}
        to="/library"
      >
        {track.title}
      </Link>
      <span className="truncate text-xs text-muted-foreground">
        {new Date(track.createdAt).toLocaleString("ja-JP")}
      </span>
    </div>
  )
}

function PlaybackRateButton() {
  const rate = useAtomValue(playbackRateAtom)
  const cycle = useSetAtom(cyclePlaybackRateAtom)

  return (
    <Button
      aria-label={`再生速度を変える (現在 ${rate}倍)`}
      className="h-11 w-11 shrink-0 tabular-nums md:h-9 md:w-12"
      onClick={() => cycle()}
      variant="ghost"
    >
      {rate}×
    </Button>
  )
}

function CloseButton() {
  const close = useSetAtom(closePlayerAtom)

  return (
    <Button
      aria-label="再生を終了してバーを閉じる"
      className="h-11 w-10 shrink-0 md:size-9"
      onClick={() => close()}
      variant="ghost"
    >
      <X aria-hidden="true" />
    </Button>
  )
}
