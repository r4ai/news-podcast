import { Link } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import { ChevronDown, ChevronUp, X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  closePlayerAtom,
  currentTrackAtom,
  playerExpandedAtom,
  type PlayerTrack,
} from "../atoms"
import { EpisodeArtwork } from "./episode-artwork"
import { NowPlayingPanel } from "./now-playing-panel"
import { PlaybackBusyLabel, PlaybackErrorBanner } from "./playback-notice"
import { PlaybackRateSelect } from "./playback-rate-select"
import { PlaybackScrubber, PlaybackTimeReadout } from "./playback-scrubber"
import { TransportControls } from "./transport-controls"
import { VolumeControl } from "./volume-control"

/**
 * 画面下端に浮かぶ再生バー。
 *
 * routeの外 (`AppShell`) に立っているので、ページを移っても音は途切れない。
 * ここが購読するのは「今どの番組が載っているか」と「開いているか」だけで、
 * 位置・再生状態・速度・音量はそれぞれを描くcomponentが自分で購読する。
 *
 * ## 面の積み方
 *
 * 帯を画面幅いっぱいに敷かず、**縁から浮かせた1枚のglassの板**にする。
 * 下に本文が透けるので、バーが本文を切り落としているのではなく上に載って
 * いることが判る。滲みを持つのはこの板だけで、目盛り・時刻・波はすべて板の
 * **前面** に描く。`backdrop-filter`が読むのは後ろに描かれたものだけなので、
 * 毎秒数回動く目盛りは滲みの計算を呼ばない (docs/design.md §7.2)。
 *
 * ## 段の作り
 *
 * 常設は1行だけ。速度・音量・大きい目盛り・原稿への道は展開した段に置く。
 * 常時2段にすると、聴いていない時間まで本文が2行ぶん削られる。
 */
/**
 * 展開した段のid。畳んでいる間は指す先が無いが、`aria-expanded="false"`が
 * 併記されていれば「今は無い」と読める。
 */
const PANEL_ID = "now-playing-panel"

export function PlayerBar() {
  const track = useAtomValue(currentTrackAtom)
  const expanded = useAtomValue(playerExpandedAtom)
  const setExpanded = useSetAtom(playerExpandedAtom)
  if (track === null) return null

  return (
    <div
      aria-label="再生中の番組"
      className={cn(
        // モバイルは下部ナビの上へ浮かせる。ナビの実高は`--app-nav-h`が持つ。
        "fixed inset-x-0 bottom-[calc(var(--app-nav-h)+0.5rem)] z-30 px-2 md:bottom-3 md:pr-4 md:pl-[15rem]",
        // 枠は板の外側の余白でしかない。ここで操作を受けると、板の脇を押した
        // だけで本文の操作が効かなくなる。
        "pointer-events-none"
      )}
      // `AppShell`がこの印を`:has()`で見て、本文末尾の余白を確保する。
      data-slot="player-bar"
      role="region"
    >
      <div
        className={cn(
          "glass-surface pointer-events-auto overflow-hidden rounded-3xl",
          // 幅を本文と同じ尺で止める。画面幅いっぱいに伸ばすと、広い画面ほど
          // 題名と操作の間が開き、目を左右に往復させないと今の状態が読めない。
          "mx-auto w-full max-w-3xl"
        )}
        // 展開中のEscapeは畳むだけ。閉じる(音を止める)とは別の操作なので
        // 重ねない。板の外へ伝えないのは、記事一覧などの選択解除まで
        // 巻き添えにしないため。
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !expanded) return
          event.stopPropagation()
          setExpanded(false)
        }}
      >
        <PlaybackErrorBanner />

        {expanded ? <NowPlayingPanel id={PANEL_ID} track={track} /> : null}

        {/*
          常設の行。**子の位置は開閉で変えない**。開閉ボタンの位置が段の間で
          動くと、押した瞬間にその要素ごと作り直されてfocusが本文の先頭へ
          落ちる。位置を固定して、押した指とfocusの両方をその場に留める。
        */}
        <div
          className={cn(
            "relative flex items-center",
            expanded
              ? "justify-between gap-2 px-3 pb-3"
              : // 目盛りの掴み代(14px)が題名へ食い込まないよう、上だけ厚く取る。
                "gap-2 px-2 pt-3 pb-2 sm:px-3"
          )}
        >
          {/* 折りたたみ時は、板の上端の縁そのものが目盛りになる。 */}
          {expanded ? null : <PlaybackScrubber />}

          {expanded ? (
            // 右端の開閉ボタンと釣り合うおもり。操作列を行の中央に据える。
            <span aria-hidden="true" className="w-[4.5rem] shrink-0" />
          ) : (
            <>
              <EpisodeArtwork className="size-11" episodeId={track.episodeId} />
              <TrackSummary track={track} />
            </>
          )}

          <TransportControls expanded={expanded} />

          {/*
            広い幅では、速度と音量を展開せずに触れる。狭い幅で同じことを
            すると題名が潰れるので、そちらは展開した段が引き受ける。
          */}
          {expanded ? null : (
            <div className="hidden items-center gap-1 lg:flex">
              <PlaybackRateSelect />
              <VolumeControl />
            </div>
          )}

          <div className="flex shrink-0 items-center gap-0.5">
            <ExpandToggle expanded={expanded} onToggle={setExpanded} />
            <CloseButton />
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
    <div className="flex min-w-0 flex-1 flex-col">
      <Link
        className="truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        search={{ episode: track.episodeId }}
        title={track.title}
        to="/library"
      >
        {track.title}
      </Link>
      {/*
        2行目は「どこまで来たか」。読み込み待ちも同じ行へ収め、待つたびに
        バーの高さが変わらないようにする。
      */}
      <div className="flex min-w-0 items-center gap-2">
        <PlaybackBusyLabel />
        <PlaybackTimeReadout className="truncate" />
      </div>
    </div>
  )
}

/**
 * 段の開閉。
 *
 * `aria-expanded`と`aria-controls`で「押すと何が増えるか」を先に伝える。
 * 名札を状態で変えない (常に「再生の詳細」) のは、読み上げが状態を
 * `aria-expanded`から読むので、名札にも入れると二重に読まれるため。
 */
function ExpandToggle({
  expanded,
  onToggle,
}: {
  readonly expanded: boolean
  readonly onToggle: (next: boolean) => void
}) {
  const Icon = expanded ? ChevronDown : ChevronUp

  return (
    <Button
      aria-controls={PANEL_ID}
      aria-expanded={expanded}
      aria-label="再生の詳細"
      className="size-9 shrink-0 rounded-full"
      onClick={() => onToggle(!expanded)}
      size="icon-lg"
      variant="ghost"
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}

function CloseButton() {
  const close = useSetAtom(closePlayerAtom)

  return (
    <Button
      aria-label="再生を終了してバーを閉じる"
      className="size-9 shrink-0 rounded-full"
      onClick={() => close()}
      size="icon-lg"
      variant="ghost"
    >
      <X aria-hidden="true" />
    </Button>
  )
}
