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
      <input
        aria-label="音量"
        aria-valuetext={`${percent}%`}
        // 押して開くpopoverにしない。音量は「鳴らしながら合わせる」ものなので、
        // 開く操作を挟むと合わせている間ずっと本文が覆われる。
        className={cn(
          "h-6 w-16 cursor-pointer appearance-none rounded-full bg-transparent outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-24",
          // 溝は`foreground/15`。glassの面の上では`border`は薄すぎて消える。
          "[&::-webkit-slider-runnable-track]:h-[4px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-foreground)_var(--level),color-mix(in_oklch,var(--color-foreground)_15%,transparent)_var(--level))]",
          "[&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm",
          "[&::-moz-range-track]:h-[4px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-foreground/15",
          "[&::-moz-range-progress]:h-[4px] [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-foreground",
          "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground"
        )}
        max={1}
        min={0}
        onChange={(event) => setVolume(Number(event.target.value))}
        step={0.05}
        style={{ "--level": `${percent}%` } as CSSProperties}
        type="range"
        value={effective}
      />
    </div>
  )
}
