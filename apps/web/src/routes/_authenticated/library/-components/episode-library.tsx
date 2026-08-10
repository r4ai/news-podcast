import { Library } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import type { Episode } from "@/features/episodes"
import { useEpisodeLibrary } from "../-hooks/use-episode-library"
import { AudioPlayer } from "./audio-player"
import { EpisodeCard } from "./episode-card"

/** データ接続: hookを呼び、viewへ渡すだけ。 */
export function EpisodeLibrary() {
  const library = useEpisodeLibrary()
  return <EpisodeLibraryView {...library} />
}

export type EpisodeLibraryViewProps = {
  readonly episodes: readonly Episode[]
  readonly audioUrl?: string
  readonly playingEpisodeId?: string
  readonly pending: boolean
  readonly play: (episodeId: string) => void
}

export function EpisodeLibraryView({
  audioUrl,
  episodes,
  pending,
  playingEpisodeId,
  play,
}: EpisodeLibraryViewProps) {
  if (episodes.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Library aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>完成した番組はまだありません</EmptyTitle>
          <EmptyDescription>
            「今日」から最初のニュース番組を生成してください。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {audioUrl ? <AudioPlayer src={audioUrl} /> : null}
      <div className="flex flex-col gap-4">
        {episodes.map((episode) => (
          <EpisodeCard
            disabled={pending}
            episode={episode}
            key={episode.id}
            loading={playingEpisodeId === episode.id}
            onPlay={play}
          />
        ))}
      </div>
    </div>
  )
}
