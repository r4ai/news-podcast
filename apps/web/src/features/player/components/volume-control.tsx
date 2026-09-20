import { useAtomValue, useSetAtom } from "jotai"
import { Volume1, Volume2, VolumeX } from "lucide-react"
import type { CSSProperties } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { mutedAtom, setVolumeAtom, toggleMutedAtom, volumeAtom } from "../atoms"

/**
 * 音量。
 *
 * 常設の1行では**アイコンだけ**を出し、押すとその場へ帯が重なって開く。
 * 帯を常に並べると、常設の行で最も長く取りたい題名から80px以上を奪う。
 * 音量を合わせるのは稀な操作で、題名を読むのは常時なので、常設の幅は
 * 題名へ回す。
 *
 * 広い面 (展開段・Drawer) では開く操作を挟まず並べる。そこには幅があり、
 * 「鳴らしながら合わせる」を1操作で始められる方が良い。
 */
export function VolumeControl({
  className,
  variant = "inline",
}: {
  readonly className?: string
  /** `"inline"`は帯を並べる。`"popover"`はアイコンだけ置き、押して開く。 */
  readonly variant?: "inline" | "popover"
}) {
  const state = useVolumeState()

  if (variant === "inline") {
    return (
      <div className={cn("flex shrink-0 items-center gap-1", className)}>
        <MuteButton {...state} />
        <VolumeSlider {...state} />
      </div>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={`音量 (現在 ${state.percent}%)`}
            className={cn("size-9 shrink-0 rounded-full", className)}
            size="icon-lg"
            variant="ghost"
          />
        }
      >
        <VolumeIcon {...state} />
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="flex w-auto items-center gap-2 rounded-full p-2"
        side="inline-start"
        sideOffset={4}
      >
        <MuteButton {...state} />
        <VolumeSlider {...state} />
      </PopoverContent>
    </Popover>
  )
}

type VolumeState = ReturnType<typeof useVolumeState>

function useVolumeState() {
  const volume = useAtomValue(volumeAtom)
  const muted = useAtomValue(mutedAtom)
  const setVolume = useSetAtom(setVolumeAtom)
  const toggleMuted = useSetAtom(toggleMutedAtom)

  const effective = muted ? 0 : volume
  return {
    effective,
    muted,
    percent: Math.round(effective * 100),
    setVolume,
    toggleMuted,
  }
}

/**
 * 音の大きさを絵で言う。
 *
 * 0・小・大で形が変わる。切り替わる瞬間に形だけが差し替わると、目には
 * 「ちらついた」としか映らない。`key`で要素ごと入れ替え、波が湧くように
 * 出す。動きを止める設定では、形だけが変わる。
 */
function VolumeIcon({ effective }: Pick<VolumeState, "effective">) {
  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2

  return (
    <Icon
      aria-hidden="true"
      className="animate-in zoom-in-75 duration-200 ease-apple fade-in motion-reduce:animate-none"
      key={Icon.displayName ?? String(effective === 0)}
    />
  )
}

function MuteButton({ effective, muted, toggleMuted }: VolumeState) {
  return (
    <Button
      aria-label={muted ? "消音を解除" : "消音にする"}
      aria-pressed={muted}
      className="size-9 shrink-0 rounded-full"
      onClick={() => toggleMuted()}
      size="icon-lg"
      variant="ghost"
    >
      <VolumeIcon effective={effective} />
    </Button>
  )
}

/**
 * 溝と塗りとつまみは自前で描き、要素は掴む面だけを担う。UAのつまみに幅を
 * 持たせると`幅 − つまみ幅`の範囲でしか動かず、全幅に対する塗りと両端でずれる
 * (目盛りと同じ理由)。
 */
function VolumeSlider({ effective, percent, setVolume }: VolumeState) {
  return (
    <div className="group relative h-6 w-20 shrink-0 sm:w-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-foreground/15 [contain:paint]"
      >
        <div
          className="h-full w-full origin-left rounded-full bg-foreground transition-transform duration-100 ease-apple motion-reduce:transition-none"
          style={{ transform: `scaleX(${effective})` } as CSSProperties}
        />
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-sm transition-[left,transform] duration-100 ease-apple group-has-focus-visible:scale-125 motion-reduce:transition-none"
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
  )
}
