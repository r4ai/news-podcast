import { useAtomValue } from "jotai"

import { cn } from "@workspace/ui/lib/utils"

import { listeningLabel, progressEntryAtomFamily } from "@/features/player"
import { episodeMetaLabel, type Episode } from "../-model"
import { EpisodePlayButton } from "./episode-play-button"

export type EpisodeRowProps = {
  readonly episode: Episode
  readonly isSelected: boolean
  readonly onSelect: (episode: Episode) => void
}

/**
 * 一覧の1行。
 *
 * 「鳴らす」と「開く」を別の操作として並べる。行全体を再生にすると台本を
 * 読みたいだけで音が出るし、行全体を開くにすると鳴らすまでが2手になる。
 *
 * この行自身は再生状態を購読しない。購読しているのは再生ボタン (この番組が
 * 鳴っているか) と聴取状態 (この番組の記録) だけで、どちらも番組ごとに
 * 分かれている。
 */
export function EpisodeRow({ episode, isSelected, onSelect }: EpisodeRowProps) {
  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-1 border-b border-border/60 pr-2 pl-1 transition-colors",
          isSelected ? "bg-accent" : "hover:bg-muted/50"
        )}
      >
        <EpisodePlayButton className="shrink-0" episode={episode} />
        <button
          aria-current={isSelected ? "true" : undefined}
          className="flex min-h-11 flex-1 flex-col justify-center gap-1 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => onSelect(episode)}
          type="button"
        >
          {/* 題名は省略しない。番組名は日付と語彙が似ていて、末尾を落とすと見分けが付かない。 */}
          <span className="text-sm leading-5 font-medium">{episode.title}</span>
          {/*
            選択行の背景(accent)の上では`muted-foreground`が4.5:1を割る。
            前景寄りへ上げる (docs/design.md §7.1)。
          */}
          <span
            className={cn(
              "flex flex-wrap items-center gap-x-2 text-xs",
              isSelected ? "text-foreground/70" : "text-muted-foreground"
            )}
          >
            <span>{episodeMetaLabel(episode)}</span>
            <ListeningBadge episodeId={episode.id} />
          </span>
        </button>
      </div>
    </li>
  )
}

/** 聴取状態。記録が動いたときだけ、この行のここだけが描き直される。 */
function ListeningBadge({ episodeId }: { readonly episodeId: string }) {
  const entry = useAtomValue(progressEntryAtomFamily(episodeId))
  const label = listeningLabel(entry)
  if (label === undefined) return null

  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.6875rem] font-medium text-secondary-foreground tabular-nums">
      {label}
    </span>
  )
}
