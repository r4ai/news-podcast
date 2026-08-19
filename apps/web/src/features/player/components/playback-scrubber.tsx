import { useAtomValue, useSetAtom } from "jotai"
import type { CSSProperties } from "react"

import { cn } from "@workspace/ui/lib/utils"

import {
  playbackDurationAtom,
  playbackPositionAtom,
  seekToAtom,
} from "../atoms"
import { formatPlaybackTime, progressRatio } from "../model"

/**
 * 目盛り。`timeupdate`を購読するのはこのcomponentと時刻表示だけに閉じる。
 *
 * 現在位置は毎秒数回動く。バーの見出しや操作ボタンと同じ購読単位に置くと、
 * 鳴っている間ずっと画面下端が描き直され続ける (docs/design.md §7.2)。
 *
 * 置き場所はバーの上端の縁。幅いっぱいを掴めるので、幅に関係なく同じ操作性に
 * なる。目盛りを操作列の中へ入れると、狭い幅では数十pxまで縮んで実質使えない。
 *
 * 進んだ量は`scaleX`で示す。塗り分けを背景のグラデーションで描くと、位置が
 * 動くたびに帯そのものを描き直すことになり、下端に重なる面(下部ナビ・
 * backdrop)まで巻き込んで再描画される。
 */
export function PlaybackScrubber({
  className,
}: {
  readonly className?: string
}) {
  const position = useAtomValue(playbackPositionAtom)
  const duration = useAtomValue(playbackDurationAtom)
  const seekTo = useSetAtom(seekToAtom)

  // 総時間は契約に無く、`loadedmetadata`が届くまで判らない。判るまでは
  // 掴んで動かせる対象が無いので、操作を渡さない。
  const seekable = duration !== undefined && duration > 0
  const value = Math.min(position, seekable ? duration : position)

  return (
    <div
      className={cn(
        // バーの上端の縁に重ねる。掴み代は16pxあり、見えている帯より広い。
        "group absolute inset-x-0 top-0 z-10 h-4 -translate-y-1/2",
        className
      )}
    >
      {/* 見えている帯。`contain`で描き直しをこの箱の中に閉じる。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden bg-border transition-[height] duration-150 ease-out group-hover:h-[5px] group-has-focus-visible:h-[5px] motion-reduce:transition-none [contain:paint]"
      >
        <div
          className="h-full w-full origin-left bg-foreground"
          style={
            {
              transform: `scaleX(${progressRatio(position, duration)})`,
            } as CSSProperties
          }
        />
      </div>
      <input
        aria-label="再生位置"
        aria-valuetext={`${formatPlaybackTime(position)} / ${formatPlaybackTime(duration)}`}
        className={cn(
          "absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-default",
          // 帯は上の箱が描くので、要素自身の溝は透かす。
          "[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent",
          "[&::-moz-range-track]:h-full [&::-moz-range-track]:bg-transparent",
          "[&::-moz-range-progress]:bg-transparent",
          // つまみは掴む位置を示すためだけのもの。常時出すと3pxの帯の上に丸が
          // 居座り、帯そのものが掴む対象に見えなくなる。触れた時だけ出す。
          "[&::-webkit-slider-thumb]:mt-[2px] [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:opacity-0 [&::-webkit-slider-thumb]:transition-opacity",
          "group-hover:[&::-webkit-slider-thumb]:opacity-100 focus-visible:[&::-webkit-slider-thumb]:opacity-100",
          "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:opacity-0",
          "group-hover:[&::-moz-range-thumb]:opacity-100 focus-visible:[&::-moz-range-thumb]:opacity-100"
        )}
        disabled={!seekable}
        max={seekable ? duration : 1}
        min={0}
        onChange={(event) => seekTo(Number(event.target.value))}
        step={1}
        type="range"
        value={value}
      />
    </div>
  )
}

/**
 * 経過・総時間・残り。位置を購読するのは目盛りとここだけで、操作列は購読
 * しない。1行に3つ並べると読み取る手間が増えるので、残りは括弧で添える。
 */
export function PlaybackTimeReadout({
  className,
}: {
  readonly className?: string
}) {
  const position = useAtomValue(playbackPositionAtom)
  const duration = useAtomValue(playbackDurationAtom)
  const remaining =
    duration !== undefined && duration > 0 ? duration - position : undefined

  return (
    <p
      className={cn(
        "shrink-0 text-xs tabular-nums text-muted-foreground",
        className
      )}
    >
      <span className="text-foreground">{formatPlaybackTime(position)}</span>
      {" / "}
      {formatPlaybackTime(duration)}
      <span className="hidden sm:inline">
        {remaining === undefined
          ? ""
          : ` (残り ${formatPlaybackTime(remaining)})`}
      </span>
    </p>
  )
}
