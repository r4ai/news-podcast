import { useAtomValue, useSetAtom } from "jotai"
import { Pause, Play } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  episodePlayingAtomFamily,
  playEpisodeAtom,
  togglePlaybackAtom,
} from "@/features/player"
import type { Episode } from "../-model"

export type EpisodePlayButtonProps = {
  readonly episode: Episode
  readonly className?: string
  /** 文言を伴う大きい形にするか。詳細側だけがtrueにする。 */
  readonly labelled?: boolean
}

/**
 * 番組を鳴らす操作。一覧の行にも詳細にも同じものを置く。
 *
 * 購読するのは「この番組が鳴っているか」だけ。`isPlayingAtom`を直に見ると、
 * 1回の再生/停止で一覧の全行が描き直される (docs/design.md §7.2)。
 */
export function EpisodePlayButton({
  className,
  episode,
  labelled = false,
}: EpisodePlayButtonProps) {
  const playing = useAtomValue(episodePlayingAtomFamily(episode.id))
  const play = useSetAtom(playEpisodeAtom)
  const toggle = useSetAtom(togglePlaybackAtom)

  const label = playing ? "一時停止" : "再生"

  return (
    <Button
      aria-label={labelled ? undefined : `${episode.title}を${label}`}
      className={cn(
        labelled ? "min-h-11 sm:min-h-9" : "size-11 rounded-full md:size-9",
        className
      )}
      onClick={() =>
        playing
          ? toggle()
          : play({
              episodeId: episode.id,
              title: episode.title,
              createdAt: episode.createdAt,
            })
      }
      size={labelled ? "lg" : "icon-lg"}
      variant={labelled ? "default" : "ghost"}
    >
      {playing ? (
        <Pause
          aria-hidden="true"
          data-icon={labelled ? "inline-start" : undefined}
        />
      ) : (
        <Play
          aria-hidden="true"
          data-icon={labelled ? "inline-start" : undefined}
        />
      )}
      {labelled ? label : null}
    </Button>
  )
}
