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
 * 目盛り。`timeupdate`を購読するのはこのcomponentだけに閉じる。
 *
 * 現在位置は毎秒数回動く。バーの見出しや操作ボタンと同じ購読単位に置くと、
 * 鳴っている間ずっと画面下端が描き直され続ける (docs/design.md §7.2)。
 *
 * 狭い幅ではバーの上端の細い線になり、`md`から時刻を伴う行になる。同じ要素の
 * 置き場所を変えるだけなので、操作の実体は1つしかない。
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
  const remaining = seekable ? duration - position : undefined

  return (
    <div
      className={cn(
        "absolute inset-x-0 top-0 flex -translate-y-1/2 items-center gap-2 px-2 md:static md:translate-y-0 md:px-0",
        className
      )}
    >
      <span className="hidden w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground md:inline">
        {formatPlaybackTime(position)}
      </span>
      <input
        aria-label="再生位置"
        aria-valuetext={`${formatPlaybackTime(position)} / ${formatPlaybackTime(duration)}`}
        className={cn(
          "h-4 w-full min-w-0 cursor-pointer appearance-none rounded-full bg-transparent outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
          // 再生済みの部分を塗り分ける。装飾ではなく進捗そのものなので、
          // 停止位置を持つ2色で表す。
          "[&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-foreground)_var(--played),var(--color-border)_var(--played))]",
          "[&::-moz-range-track]:h-[3px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-border",
          "[&::-moz-range-progress]:h-[3px] [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-foreground",
          // つまみは狭い幅では出さない。3pxの線の上に丸が乗ると、線そのものが
          // 掴む対象に見えなくなる。
          "[&::-webkit-slider-thumb]:mt-[-4.5px] [&::-webkit-slider-thumb]:hidden [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground md:[&::-webkit-slider-thumb]:block",
          "[&::-moz-range-thumb]:hidden [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground md:[&::-moz-range-thumb]:block"
        )}
        disabled={!seekable}
        max={seekable ? duration : 1}
        min={0}
        onChange={(event) => seekTo(Number(event.target.value))}
        step={1}
        style={
          {
            "--played": `${progressRatio(position, duration) * 100}%`,
          } as CSSProperties
        }
        type="range"
        value={value}
      />
      <span className="hidden w-12 shrink-0 text-xs tabular-nums text-muted-foreground md:inline">
        {remaining === undefined
          ? "--:--"
          : `-${formatPlaybackTime(remaining)}`}
      </span>
    </div>
  )
}
