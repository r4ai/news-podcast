import { useAtomValue, useSetAtom } from "jotai"
import type { CSSProperties } from "react"

import { cn } from "@workspace/ui/lib/utils"

import {
  isBufferingAtom,
  playbackDurationAtom,
  playbackPositionAtom,
  seekToAtom,
} from "../atoms"
import { formatPlaybackTime, progressRatio } from "../model"

/**
 * 目盛りが要る値をまとめて読む。`timeupdate`を購読するのは、この関数を呼ぶ
 * componentだけに閉じる。
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
    remaining: seekable ? duration - position : undefined,
    value: Math.min(position, seekable ? duration : position),
    valueText: `${formatPlaybackTime(position)} / ${formatPlaybackTime(duration)}`,
  }
}

/**
 * 掴む面。UAが描く溝とつまみは透かし、要素自身は「どこを掴んだか」だけを担う。
 *
 * **つまみの幅を0にするのが要**。幅を持たせると、UAはつまみが端から食み出さ
 * ないよう`幅 − つまみ幅`の範囲でしか動かさない。塗りは全幅に対する`scaleX`で
 * 描いているので、両端で最大「つまみ幅の半分」ずれる (実測: 14pxのつまみで
 * 0%のとき点だけが7px右に浮き、100%のとき塗りが点を7px追い越す)。
 *
 * 幅を0にすると、値と位置の対応が**全幅にわたって1対1**になり、塗りの先端・
 * 自前のつまみ・指の位置が完全に一致する。見えるつまみは`ScrubberRail`が描く。
 */
function grabStyles(className?: string) {
  return cn(
    "absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-default",
    /*
      焦点の輪はここが持つ。UAの溝もつまみも透かしてあるので、既定の`outline`を
      消したままだと、Tabで着いても**何も変わらない**。帯が太る・つまみが出る
      といった変化は触れた時と同じ見た目で、しかも展開段はつまみを常に出して
      いるので変化が起きない。掴み代そのものを輪で囲って、どこに居るかを示す。
    */
    "rounded-full focus-visible:ring-3 focus-visible:ring-ring/50",
    "[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent",
    "[&::-moz-range-track]:h-full [&::-moz-range-track]:bg-transparent",
    "[&::-moz-range-progress]:bg-transparent",
    "[&::-webkit-slider-thumb]:h-full [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:appearance-none",
    "[&::-moz-range-thumb]:h-full [&::-moz-range-thumb]:w-0 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0",
    className
  )
}

/**
 * 見えている帯とつまみ。
 *
 * 進んだ量は`scaleX`で示す。塗り分けを背景のgradientで描くと、位置が動くたびに
 * 帯そのものを描き直すことになる。glassの面はこの帯より**後ろ**にあるので、
 * 前面の`transform`は滲みの再計算を呼ばない。
 *
 * つまみは`left`で置く。`ratio`の位置に中心が来るので、塗りの先端と必ず揃う。
 */
function ScrubberRail({
  knob,
  knobClassName,
  ratio,
  trackClassName,
}: {
  /** つまみの出し方。`"hover"`は触れた時だけ、`"always"`は常に。 */
  readonly knob: "none" | "hover" | "always"
  readonly knobClassName?: string
  readonly ratio: number
  readonly trackClassName: string
}) {
  return (
    <>
      {/* `contain`で描き直しをこの箱の中に閉じる。 */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute overflow-hidden bg-foreground/15 [contain:paint]",
          trackClassName
        )}
      >
        <div
          className="h-full w-full origin-left rounded-full bg-foreground"
          style={{ transform: `scaleX(${ratio})` } as CSSProperties}
        />
      </div>
      {knob === "none" ? null : (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-sm transition-transform group-has-focus-visible:scale-125 motion-reduce:transition-none",
            knob === "hover" &&
              "opacity-0 transition-opacity group-hover:opacity-100 group-has-focus-visible:opacity-100 motion-reduce:transition-none",
            knobClassName
          )}
          style={{ left: `${ratio * 100}%` } as CSSProperties}
        />
      )}
    </>
  )
}

/**
 * 折りたたみ時の目盛りと時刻。題名の**下の1行**を丸ごと担う。
 *
 * ## 置き場所が幅で変わる
 *
 * `sm`以上では、それまで時刻の文字だけが座っていた行を**そのまま実目盛りへ
 * 格上げ**する。経過を左端・残りを右端に置いた、プレイヤーらしい目盛りになる。
 * 行を増やさないので板の高さは変わらない。
 *
 * `sm`未満では同じ要素を板の上端の縁へ逃がす。狭い幅の題名の列は100px前後
 * しかなく、両端に時刻を置くと帯が30pxまで縮んで実質掴めない。縁へ出せば
 * 板の幅いっぱいを掴めて、時刻は下の行が文字で引き受ける。
 *
 * 要素はどちらも**同じ1つ**で、`absolute`か否かだけをCSSが切り替える。2つ
 * 置くと、位置の購読も目盛りも二重になる。
 */
export function PlaybackScrubber({
  className,
}: {
  readonly className?: string
}) {
  const {
    duration,
    position,
    ratio,
    remaining,
    seekable,
    seekTo,
    value,
    valueText,
  } = usePlaybackRange()
  const buffering = useAtomValue(isBufferingAtom)

  const trailing =
    remaining === undefined ? "--:--" : `-${formatPlaybackTime(remaining)}`

  return (
    <>
      <div
        className={cn(
          "group z-10",
          /*
            狭い幅: 板の上端の縁いっぱい。**内側へ寄せない**。

            板は`overflow`を切らず、代わりにこの帯が自分の形を`clip-path`で
            切る。板と同じ半径の角丸で切るので、帯は縁の曲がりまで辿って
            消える。掴み代は切らないので、角の位置を押しても先頭・末尾へ着く。
          */
          "absolute inset-x-0 top-0 h-5",
          // sm以上: 題名の下の行。縁から離れるので切る必要が無い。
          "sm:static sm:flex sm:h-5 sm:items-center sm:gap-3",
          className
        )}
      >
        <span className="hidden shrink-0 text-xs tabular-nums text-foreground sm:block">
          {formatPlaybackTime(position)}
        </span>
        <div className="relative h-full sm:min-w-0 sm:flex-1">
          {/*
            **見えるものだけ**を板の形に切る。`inset()`の下を大きく外へ出すと、
            切る枠の上の角だけが板と同じ半径で丸まり、帯は縁の曲がりまで辿って
            消える。掴み代を持つのは下の`input`で、そちらは切らない。だから
            角の位置を押しても先頭・末尾へ着く。
          */}
          <div className="pointer-events-none absolute inset-0 [clip-path:inset(0_0_-200px_0_round_var(--radius-3xl))] sm:[clip-path:none]">
            <ScrubberRail
              knob={seekable ? "hover" : "none"}
              /*
              狭い幅では出さない。帯は板の縁に密着していて、つまみは掴み代の
              上下中央に来るので、帯から5px下にぶら下がる。smからは帯が行の
              中央へ移るので、位置が合う。
            */
              knobClassName="hidden sm:block"
              ratio={ratio}
              trackClassName={cn(
                // 縁に密着した3pxの帯。触れると太って掴めることを示す。
                "inset-x-0 top-0 h-[3px] transition-[height] duration-150 ease-out group-hover:h-[5px] group-has-focus-visible:h-[5px] motion-reduce:transition-none",
                // smからは行の中で上下中央に置き、角を丸める。
                "sm:inset-x-0 sm:top-1/2 sm:h-1 sm:-translate-y-1/2 sm:rounded-full sm:group-hover:h-1.5"
              )}
            />
          </div>
          <input
            aria-label="再生位置"
            aria-valuetext={valueText}
            className={grabStyles()}
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
          残りは負の符号を付けて右端へ。経過と同じ書式で左右に並べると、
          どちらがどちらか読むまで判らない。待っている間はここが理由を言う。

          `key`で要素ごと差し替える。同じ要素の属性だけを`aria-live`へ変えると、
          読み上げは「中身が変わった生きた領域」として扱わず、何も言わない。
        */}
        {buffering ? (
          <span
            aria-live="polite"
            className="hidden shrink-0 text-xs text-muted-foreground sm:block"
            key="busy"
            role="status"
          >
            読み込み中…
          </span>
        ) : (
          <span
            className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block"
            key="time"
          >
            {trailing}
          </span>
        )}
      </div>

      {/*
        狭い幅の時刻。目盛りは縁へ出ているので、この行は文字だけを担う。
        待っている間は同じ場所が理由を言う。並べて置くと、320pxでは題名の列
        (102px)へ137px入れることになり、再生ボタンへ重なる。
      */}
      {buffering ? (
        <p
          aria-live="polite"
          className="truncate text-xs text-muted-foreground sm:hidden"
          key="busy"
          role="status"
        >
          読み込み中…
        </p>
      ) : (
        <p
          className="truncate text-xs tabular-nums text-muted-foreground sm:hidden"
          key="time"
        >
          <span className="text-foreground">
            {formatPlaybackTime(position)}
          </span>
          {" / "}
          {formatPlaybackTime(duration)}
        </p>
      )}
    </>
  )
}

/**
 * 展開時の目盛り。帯を太くし、経過と残りを左右の端へ置く。
 *
 * 時刻を**同じcomponentの中**で描くのは、位置を読む購読を1つに保つため。
 * 帯と時刻を別々のcomponentにすると、1回の`timeupdate`で2つが動く。
 */
export function PlaybackScrubberFull({
  className,
}: {
  readonly className?: string
}) {
  const {
    duration,
    position,
    ratio,
    remaining,
    seekable,
    seekTo,
    value,
    valueText,
  } = usePlaybackRange()

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {/* 掴み代は24px。指で触る環境では、ここが唯一の「大きい目盛り」になる。 */}
      <div className="group relative h-6">
        <ScrubberRail
          // 展開段は縁から離れているので、つまみを常に出して掴み所を示せる。
          knob={seekable ? "always" : "none"}
          ratio={ratio}
          trackClassName="inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
        />
        <input
          aria-label="再生位置"
          aria-valuetext={valueText}
          className={grabStyles()}
          disabled={!seekable}
          max={seekable ? duration : 1}
          min={0}
          onChange={(event) => seekTo(Number(event.target.value))}
          step={1}
          type="range"
          value={value}
        />
      </div>
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
