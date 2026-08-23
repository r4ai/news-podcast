import { useAtomValue, useSetAtom } from "jotai"
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

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
 */
export function TransportControls() {
  const playing = useAtomValue(isPlayingAtom)
  const buffering = useAtomValue(isBufferingAtom)
  const toggle = useSetAtom(togglePlaybackAtom)
  const skip = useSetAtom(skipByAtom)

  return (
    <div className="flex items-center gap-0.5">
      <SkipButton
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
        className="size-11 shrink-0 rounded-full md:size-9"
        onClick={() => toggle()}
        size="icon-lg"
      >
        {playing ? (
          <Pause aria-hidden="true" className="size-5 md:size-4" />
        ) : (
          <Play aria-hidden="true" className="size-5 md:size-4" />
        )}
      </Button>
      <SkipButton
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
  icon: Icon,
  label,
  onSkip,
  seconds,
}: {
  readonly icon: typeof RotateCcw
  readonly label: string
  readonly onSkip: () => void
  readonly seconds: number
}) {
  return (
    <Button
      aria-label={label}
      className="relative h-11 w-10 shrink-0 md:size-9"
      onClick={onSkip}
      size="icon-lg"
      variant="ghost"
    >
      <Icon aria-hidden="true" className="size-6 md:size-5" />
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center pt-px text-[0.5rem] font-semibold tabular-nums"
      >
        {seconds}
      </span>
    </Button>
  )
}
