import { useAtomValue } from "jotai"
import type { CSSProperties } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { isPlayingAtom } from "../atoms"
import { artworkHue } from "../model"

/**
 * 番組の絵。
 *
 * 契約に画像は無いので、IDから導いた色相で描く (`artworkHue`)。絵そのものに
 * 意味は無く、**題名を読まずに「今どれか」を掴む**ための目印なので、
 * 読み上げには渡さない (題名が隣にある)。
 *
 * 色を持たせるのはここだけ。バーの他の部分は既存のsemantic colorのままに
 * して、色が意味を持つ場所を1つに限る。
 */
export function EpisodeArtwork({
  className,
  episodeId,
}: {
  readonly className?: string
  readonly episodeId: string
}) {
  const hue = artworkHue(episodeId)

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl shadow-sm ring-1 ring-black/10 dark:ring-white/10",
        // 板ごと押せるので、押した手応えは絵にも返す。
        "transition-transform duration-200 ease-apple group-active/bar:scale-95 motion-reduce:transition-none",
        className
      )}
      style={
        {
          backgroundImage: `linear-gradient(145deg, oklch(0.74 0.15 ${hue}), oklch(0.46 0.17 ${(hue + 42) % 360}))`,
        } as CSSProperties
      }
    >
      <NowPlayingIndicator />
    </div>
  )
}

/** 波の本数。増やしても読み取れる情報は増えないので、最小限に留める。 */
const BAR_DELAYS_MS = [0, 180, 360] as const

/**
 * 鳴っているかどうかを絵の上で示す。
 *
 * 購読するのは「鳴っているか」だけで、位置は見ない。ここで位置まで見ると、
 * 毎秒数回この絵が描き直される (docs/design.md §7.2)。
 *
 * 動きを止める設定では棒を立てたまま出す。消してしまうと、その設定の人だけ
 * 「鳴っているか」を絵から読めなくなる。
 */
function NowPlayingIndicator() {
  const playing = useAtomValue(isPlayingAtom)
  if (!playing) return null

  return (
    <span className="absolute inset-0 flex items-end justify-center gap-[5%] p-[26%]">
      {BAR_DELAYS_MS.map((delay) => (
        <span
          className="h-full w-[9%] origin-bottom animate-player-eq rounded-full bg-white/90 motion-reduce:animate-none motion-reduce:scale-y-50"
          key={delay}
          style={{ animationDelay: `${delay}ms` } as CSSProperties}
        />
      ))}
    </span>
  )
}
