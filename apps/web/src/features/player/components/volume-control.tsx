import { useAtomValue, useSetAtom } from "jotai"
import { Volume1, Volume2, VolumeX } from "lucide-react"
import type { CSSProperties } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { mutedAtom, setVolumeAtom, toggleMutedAtom, volumeAtom } from "../atoms"

/** 消音の切り替えと音量。押して開くのではなく、常に触れる形で並べる。 */
export function VolumeControl({ className }: { readonly className?: string }) {
  const volume = useAtomValue(volumeAtom)
  const muted = useAtomValue(mutedAtom)
  const setVolume = useSetAtom(setVolumeAtom)
  const toggleMuted = useSetAtom(toggleMutedAtom)

  const effective = muted ? 0 : volume
  const percent = Math.round(effective * 100)
  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <Button
        aria-label={muted ? "消音を解除" : "消音にする"}
        aria-pressed={muted}
        className="size-9 shrink-0 rounded-full"
        onClick={() => toggleMuted()}
        size="icon-lg"
        variant="ghost"
      >
        <Icon aria-hidden="true" />
      </Button>
      {/*
        押して開くpopoverにしない。音量は「鳴らしながら合わせる」ものなので、
        開く操作を挟むと合わせている間ずっと本文が覆われる。

        目盛りと同じ組み方をする。溝と塗りとつまみは自前で描き、要素は掴む面
        だけを担う。UAのつまみに幅を持たせると`幅 − つまみ幅`の範囲でしか
        動かず、全幅に対する塗りと両端でずれる。
      */}
      <div className="relative h-6 w-16 shrink-0 sm:w-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-foreground/15 [contain:paint]"
        >
          <div
            className="h-full w-full origin-left rounded-full bg-foreground"
            style={{ transform: `scaleX(${effective})` } as CSSProperties}
          />
        </div>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-sm"
          style={{ left: `${percent}%` } as CSSProperties}
        />
        <input
          aria-label="音量"
          aria-valuetext={`${percent}%`}
          className={cn(
            "absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            "[&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent",
            "[&::-moz-range-track]:h-full [&::-moz-range-track]:bg-transparent",
            "[&::-moz-range-progress]:bg-transparent",
            "[&::-webkit-slider-thumb]:h-full [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:appearance-none",
            "[&::-moz-range-thumb]:h-full [&::-moz-range-thumb]:w-0 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-0"
          )}
          max={1}
          min={0}
          onChange={(event) => setVolume(Number(event.target.value))}
          step={0.05}
          type="range"
          value={effective}
        />
      </div>
    </div>
  )
}
