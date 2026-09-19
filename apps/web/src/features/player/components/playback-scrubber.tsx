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
 * 目盛りが要る値をまとめて読む。`timeupdate`を購読するのは、この関数を呼ぶ
 * componentと時刻表示だけに閉じる。
 *
 * 現在位置は毎秒数回動く。バーの見出しや操作ボタンと同じ購読単位に置くと、
 * 鳴っている間ずっと画面下端が描き直され続ける (docs/design.md §7.2)。
 */
function usePlaybackRange() {
  const position = useAtomValue(playbackPositionAtom)
  const duration = useAtomValue(playbackDurationAtom)
  const seekTo = useSetAtom(seekToAtom)

  // 総時間は契約に無く、`loadedmetadata`が届くまで判らない。判るまでは
  // 掴んで動かせる対象が無いので、操作を渡さない。
  const seekable = duration !== undefined && duration > 0

  return {
    duration,
    position,
    seekable,
    seekTo,
    ratio: progressRatio(position, duration),
    value: Math.min(position, seekable ? duration : position),
    valueText: `${formatPlaybackTime(position)} / ${formatPlaybackTime(duration)}`,
  }
}

/**
 * `<input type=range>`はUAが溝とつまみを描く。見えている帯は別の箱が描くので、
 * 要素自身は透かして「掴む面」だけを担う。
 *
 * 進んだ量を`scaleX`で示すのは、塗り分けを背景のgradientで描くと位置が動く
 * たびに帯そのものを描き直すことになるため。glassの面はこの帯より**後ろ**に
 * あるので、前面の`transform`は滲みの再計算を呼ばない。
 */
function trackStyles(thumb: string) {
  return cn(
    "absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-default",
    "[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent",
    "[&::-moz-range-track]:h-full [&::-moz-range-track]:bg-transparent",
    "[&::-moz-range-progress]:bg-transparent",
    thumb
  )
}

/**
 * 折りたたみ時の目盛り。バーの上端の縁そのものが進捗になる。
 *
 * 幅いっぱいを掴めるので、幅に関係なく同じ操作性になる。操作列の中へ入れると、
 * 狭い幅では数十pxまで縮んで実質使えない。
 */
export function PlaybackScrubber({
  className,
}: {
  readonly className?: string
}) {
  const { ratio, seekable, seekTo, value, duration, valueText } =
    usePlaybackRange()

  return (
    <div
      className={cn(
        // 板の角の丸み(1.5rem)ぶん内側へ寄せる。端まで伸ばすと、両端が角の
        // カーブで切り落とされる。切られるのは見た目だけではない:
        // `overflow-hidden`の丸めはヒットテストにも効くので、「先頭へ戻す」
        // 「末尾へ飛ぶ」という**両端の操作が掴めなくなる**。
        //
        // 寄せた結果、目盛りの左端が値0、右端が総時間と1対1で対応する。
        // 掴み代は14pxあり、見えている帯より広い。
        "group absolute inset-x-0 top-0 z-10 h-3.5 px-6",
        className
      )}
    >
      <div className="relative h-full">
        {/* 見えている帯。`contain`で描き直しをこの箱の中に閉じる。 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] overflow-hidden rounded-full bg-foreground/15 transition-[height] duration-150 ease-out group-hover:h-[5px] group-has-focus-visible:h-[5px] motion-reduce:transition-none [contain:paint]"
        >
          <div
            className="h-full w-full origin-left rounded-full bg-foreground"
            style={{ transform: `scaleX(${ratio})` } as CSSProperties}
          />
        </div>
        <input
          aria-label="再生位置"
          aria-valuetext={valueText}
          className={trackStyles(
            // つまみは掴む位置を示すためだけのもの。常時出すと3pxの帯の上に丸が
            // 居座り、帯そのものが掴む対象に見えなくなる。触れた時だけ出す。
            cn(
              "[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:opacity-0 [&::-webkit-slider-thumb]:transition-opacity",
              "group-hover:[&::-webkit-slider-thumb]:opacity-100 focus-visible:[&::-webkit-slider-thumb]:opacity-100",
              "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:opacity-0",
              "group-hover:[&::-moz-range-thumb]:opacity-100 focus-visible:[&::-moz-range-thumb]:opacity-100"
            )
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
    </div>
  )
}

/**
 * 展開時の目盛り。経過と残りを左右の端に置き、帯そのものを太くする。
 *
 * 時刻を**同じcomponentの中**で描くのは、位置を読む購読を1つに保つため。
 * 帯と時刻を別々のcomponentにすると、1回の`timeupdate`で2つが動く。
 */
export function PlaybackScrubberFull({
  className,
}: {
  readonly className?: string
}) {
  const { duration, position, ratio, seekable, seekTo, value, valueText } =
    usePlaybackRange()
  const remaining =
    duration !== undefined && duration > 0 ? duration - position : undefined

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="group relative h-5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-full bg-foreground/15 [contain:paint]"
        >
          <div
            className="h-full w-full origin-left rounded-full bg-foreground"
            style={{ transform: `scaleX(${ratio})` } as CSSProperties}
          />
        </div>
        <input
          aria-label="再生位置"
          aria-valuetext={valueText}
          className={trackStyles(
            cn(
              // 展開中は「掴んで動かすもの」であることを常に見せる。
              "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-125 motion-reduce:[&::-webkit-slider-thumb]:transition-none",
              "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground",
              "disabled:[&::-webkit-slider-thumb]:opacity-0 disabled:[&::-moz-range-thumb]:opacity-0"
            )
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
      {/*
        残りは負の符号を付けて右端に置く。経過と同じ書式で左右に並べると、
        どちらがどちらか読むまで判らない。
      */}
      <p className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span className="text-foreground">{formatPlaybackTime(position)}</span>
        <span>
          {remaining === undefined
            ? "--:--"
            : `-${formatPlaybackTime(remaining)}`}
        </span>
      </p>
    </div>
  )
}

/**
 * 折りたたみ時の1行。経過と総時間だけを添える。残りは展開したときに右端へ出る。
 *
 * 位置を購読するのは目盛りとここだけで、操作列は購読しない。
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
