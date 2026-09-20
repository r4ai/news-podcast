import { Link } from "@tanstack/react-router"

import { cn } from "@workspace/ui/lib/utils"

import type { PlayerTrack } from "../atoms"
import { EpisodeArtwork } from "./episode-artwork"
import { PlaybackBusyLabel, PlaybackErrorBanner } from "./playback-notice"
import { PlaybackRateSelect } from "./playback-rate-select"
import { PlaybackScrubberFull } from "./playback-scrubber"
import { TransportControls } from "./transport-controls"
import { VolumeControl } from "./volume-control"

/**
 * 展開したときに現れる中身。
 *
 * 置かれる器は幅で変わる。広い幅では板がその場で伸び、狭い幅では下端から
 * 立ち上がるDrawerになる。中身はどちらも同じなので、ここは**器を知らない**。
 *
 * 位置は購読しない。ここが購読すると、鳴っている間ずっと絵と題名まで
 * 描き直される (docs/design.md §7.2)。動く値は`PlaybackScrubberFull`の中だけ。
 */
export function NowPlayingPanel({
  className,
  "data-slot": dataSlot,
  id,
  /**
   * 原稿へ移るときに呼ぶ。
   *
   * Drawerで開いているとき、このリンクを押しても移るだけでは覆いが残る。
   * 再生バーはrouteの外に立っているので、ページが変わってもDrawerは畳まれず、
   * 着いた先の原稿を覆ったまま触れない状態になる。
   */
  onNavigate,
  /**
   * 絵と題名をここでも出すか。
   *
   * Drawerでは出す。板は背面へ退いて見えないので、何を鳴らしているかが
   * ここにしか無い。板がその場で伸びる広い幅では出さない。すぐ下の常設の行が
   * 同じ絵と題名を持っているので、並べると同じものが2つ見える。
   */
  withHeader = true,
  /** Drawerでは操作列もここが持つ。板の中では常設の行が持ったままにする。 */
  withTransport = false,
  track,
}: {
  readonly className?: string
  readonly "data-slot"?: string
  readonly id?: string
  readonly onNavigate?: () => void
  readonly withHeader?: boolean
  readonly withTransport?: boolean
  readonly track: PlayerTrack
}) {
  /*
    日付と原稿への道。「聴いている番組の根拠を確かめる」は聴いている最中に
    こそ起きるので、開けば必ず目に入る位置へ置く。
  */
  const meta = (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <span>{new Date(track.createdAt).toLocaleString("ja-JP")}</span>
      <span aria-hidden="true">·</span>
      <Link
        className="rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        /*
          畳むのは**この場で移るクリックだけ**。修飾キー付きや中ボタンの
          クリックは別のタブで開くので、この画面は動かない。それで畳むと、
          見ていた面が理由もなく消える。
        */
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            event.defaultPrevented
          ) {
            return
          }
          onNavigate?.()
        }}
        search={{ episode: track.episodeId }}
        to="/library"
      >
        原稿と出典を読む
      </Link>
    </p>
  )

  return (
    <div
      className={cn("flex flex-col gap-4", className)}
      data-slot={dataSlot}
      id={id}
    >
      {/*
        鳴らせなかったことと、やり直す道。板にも同じ行があるが、Drawerで
        開いている間は板ごと覆われて触れない。覆う側にも置く。
      */}
      {withHeader ? <PlaybackErrorBanner className="-mx-4 -mt-1" /> : null}
      {withHeader ? (
        <div className="flex items-start gap-3 sm:gap-4">
          <EpisodeArtwork className="size-20" episodeId={track.episodeId} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="line-clamp-2 text-sm font-semibold sm:text-base">
              {track.title}
            </p>
            {meta}
            <PlaybackBusyLabel />
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          {meta}
          <PlaybackBusyLabel />
        </div>
      )}

      <PlaybackScrubberFull />

      {withTransport ? (
        <div className="flex items-center justify-center pb-1">
          <TransportControls expanded />
        </div>
      ) : null}

      {/*
        速度と音量。常設の行は狭い幅で題名と操作だけで埋まるので、ここが
        どの幅でも帯として触れる唯一の置き場になる。
      */}
      <div className="flex items-center justify-between gap-2">
        <PlaybackRateSelect />
        <VolumeControl />
      </div>
    </div>
  )
}
