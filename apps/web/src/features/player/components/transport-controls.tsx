import { useAtomValue, useSetAtom } from "jotai"
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  isBufferingAtom,
  isPlayingAtom,
  skipByAtom,
  togglePlaybackAtom,
} from "../atoms"
import { SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS } from "../model"

/**
 * 再生の操作。購読するのは「鳴っているか」と「音を待っているか」だけで、
 * 位置は見ない。位置まで見ると、毎秒数回ボタンが描き直される。
 *
 * 送り・戻しは、狭い幅の折りたたみ時だけ隠す。題名・再生・展開・閉じるを
 * 並べた上に5つ目6つ目を足すと、320pxでは題名が読めなくなる。隠す代わりに、
 * **展開すればどの幅でも出る**ようにして、辿り着けなくなる道を作らない。
 */
export function TransportControls({
  expanded = false,
}: {
  readonly expanded?: boolean
}) {
  const playing = useAtomValue(isPlayingAtom)
  const buffering = useAtomValue(isBufferingAtom)
  const toggle = useSetAtom(togglePlaybackAtom)
  const skip = useSetAtom(skipByAtom)

  return (
    <div
      className={cn(
        "flex shrink-0 items-center",
        expanded ? "gap-2 sm:gap-3" : "gap-0.5"
      )}
    >
      <SkipButton
        expanded={expanded}
        icon={RotateCcw}
        label={`${SKIP_BACK_SECONDS}秒戻す`}
        onSkip={() => skip(-SKIP_BACK_SECONDS)}
        seconds={SKIP_BACK_SECONDS}
      />
      {/*
        待っている間もボタンの意味は変わらない (押せば止まる)。形を差し替えると
        押し所が動くので、名札と役割はそのままに、待っている事実だけを添える。
      */}
      <Button
        aria-busy={buffering || undefined}
        aria-label={playing ? "一時停止" : "再生"}
        className={cn(
          "relative shrink-0 rounded-full shadow-sm",
          expanded ? "size-13" : "size-11 md:size-10"
        )}
        onClick={() => toggle()}
        size="icon-lg"
      >
        {playing ? (
          <Pause
            aria-hidden="true"
            className={cn("fill-current", expanded ? "size-6" : "size-5")}
          />
        ) : (
          <Play
            aria-hidden="true"
            className={cn(
              // 三角は重心が左に寄るので、見た目の中心へ寄せる。
              "translate-x-px fill-current",
              expanded ? "size-6" : "size-5"
            )}
          />
        )}
        {/*
          待っている間だけ、ボタンの外周を1本回す。字で言うと操作列の幅が
          伸び縮みし、押し所が動く。
        */}
        {buffering ? (
          <span
            aria-hidden="true"
            className="absolute -inset-[3px] animate-spin rounded-full border-2 border-transparent border-t-current opacity-70 motion-reduce:animate-none motion-reduce:opacity-40"
          />
        ) : null}
      </Button>
      <SkipButton
        expanded={expanded}
        icon={RotateCw}
        label={`${SKIP_FORWARD_SECONDS}秒進める`}
        onSkip={() => skip(SKIP_FORWARD_SECONDS)}
        seconds={SKIP_FORWARD_SECONDS}
      />
    </div>
  )
}

/**
 * 送り・戻しの幅は矢印だけでは判らない。円弧の内側へ秒数を重ね、
 * 押す前に「どれだけ動くか」を読めるようにする。
 */
function SkipButton({
  expanded,
  icon: Icon,
  label,
  onSkip,
  seconds,
}: {
  readonly expanded: boolean
  readonly icon: typeof RotateCcw
  readonly label: string
  readonly onSkip: () => void
  readonly seconds: number
}) {
  return (
    <Button
      aria-label={label}
      className={cn(
        "relative shrink-0 rounded-full",
        expanded ? "size-11" : "hidden size-10 sm:inline-flex"
      )}
      onClick={onSkip}
      size="icon-lg"
      variant="ghost"
    >
      <Icon aria-hidden="true" className={expanded ? "size-6" : "size-5"} />
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 grid place-items-center pt-px font-semibold tabular-nums",
          expanded ? "text-[0.5625rem]" : "text-[0.5rem]"
        )}
      >
        {seconds}
      </span>
    </Button>
  )
}
