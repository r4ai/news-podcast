import { useAtomValue, useSetAtom } from "jotai"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"

import { playbackRateAtom, setPlaybackRateAtom } from "../atoms"
import { PLAYBACK_RATES, type PlaybackRate } from "../model"

const rateItems = PLAYBACK_RATES.map((rate) => ({
  value: String(rate),
  label: `${rate}×`,
}))

/**
 * 再生速度。押すたびに巡回するボタンだと、狙った速度へ着くまで最大6回押す
 * ことになり、今どこに居るかも押してみるまで判らない。候補を開いて選ばせる。
 */
export function PlaybackRateSelect({
  className,
}: {
  readonly className?: string
}) {
  const rate = useAtomValue(playbackRateAtom)
  const setRate = useSetAtom(setPlaybackRateAtom)

  return (
    <Select
      items={rateItems}
      onValueChange={(value) => setRate(Number(value) as PlaybackRate)}
      value={String(rate)}
    >
      <SelectTrigger
        aria-label={`再生速度 (現在 ${rate}倍)`}
        className={cn(
          // glassの面の上に載るので、面と同じ質感の枠にする。`outline`の
          // 既定色だと、透けた背景によって見えたり消えたりする。
          "h-9 shrink-0 rounded-full border-transparent bg-foreground/5 tabular-nums hover:bg-foreground/10 dark:bg-foreground/10 dark:hover:bg-foreground/15",
          className
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" side="top">
        {rateItems.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
