import { Library } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Spinner } from "@workspace/ui/components/spinner"

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
  readonly hasNextPage: boolean
  readonly isFetchingNextPage: boolean
  readonly isFetchNextPageError: boolean
  readonly fetchNextPage: () => void
  readonly play: (episodeId: string) => void
}

export function EpisodeLibraryView({
  audioUrl,
  episodes,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
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
      {hasNextPage ? (
        <div className="flex flex-col items-center gap-2">
          {isFetchNextPageError ? (
            <p className="text-sm text-destructive" role="alert">
              続きを読み込めませんでした
            </p>
          ) : null}
          {isFetchingNextPage ? (
            <span
              className="sr-only"
              role="status"
              aria-label="続きを読み込み中"
            >
              続きを読み込み中
            </span>
          ) : null}
          <Button
            disabled={isFetchingNextPage}
            onClick={fetchNextPage}
            size="sm"
            variant="outline"
          >
            {isFetchingNextPage ? (
              <Spinner aria-hidden="true" data-icon="inline-start" />
            ) : null}
            {isFetchNextPageError ? "再試行" : "もっと読み込む"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
