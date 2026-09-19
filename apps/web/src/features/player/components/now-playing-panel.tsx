import { Link } from "@tanstack/react-router"

import type { PlayerTrack } from "../atoms"
import { EpisodeArtwork } from "./episode-artwork"
import { PlaybackBusyLabel } from "./playback-notice"
import { PlaybackRateSelect } from "./playback-rate-select"
import { PlaybackScrubberFull } from "./playback-scrubber"
import { VolumeControl } from "./volume-control"

/**
 * 展開したときに現れる段。
 *
 * 折りたたみ時の1行に入り切らないもの **だけ** を置く。同じものを2つの段へ
 * 重ねて出すと、展開が「増える」ではなく「並び替わる」操作になり、どちらの
 * 操作が効くのか判らなくなる。
 *
 * 位置は購読しない。ここが購読すると、鳴っている間ずっと絵と題名まで
 * 描き直される (docs/design.md §7.2)。動く値は`PlaybackScrubberFull`の中だけ。
 */
export function NowPlayingPanel({
  id,
  track,
}: {
  readonly id: string
  readonly track: PlayerTrack
}) {
  return (
    <div className="flex flex-col gap-4 px-3 pt-3 pb-1 sm:px-5 sm:pt-4" id={id}>
      <div className="flex items-start gap-3 sm:gap-4">
        <EpisodeArtwork
          className="size-16 sm:size-20"
          episodeId={track.episodeId}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            className="line-clamp-2 rounded-sm text-sm font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-base"
            search={{ episode: track.episodeId }}
            title={track.title}
            to="/library"
          >
            {track.title}
          </Link>
          {/*
            日付と原稿への道を1行に束ねる。「聴いている番組の根拠を確かめる」は
            聴いている最中にこそ起きるので、展開すれば必ず目に入る位置へ置く。
          */}
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{new Date(track.createdAt).toLocaleString("ja-JP")}</span>
            <span aria-hidden="true">·</span>
            <Link
              className="rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              search={{ episode: track.episodeId }}
              to="/library"
            >
              原稿と出典を読む
            </Link>
          </p>
          <PlaybackBusyLabel />
        </div>
      </div>

      <PlaybackScrubberFull />

      {/*
        速度と音量。常設の行は狭い幅で題名と操作だけで埋まるので、ここが
        どの幅でも触れる唯一の置き場になる。
      */}
      <div className="flex items-center justify-between gap-2">
        <PlaybackRateSelect />
        <VolumeControl />
      </div>
    </div>
  )
}
