import { Library } from "lucide-react"
import { useEffect, useEffectEvent, useRef } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"

import { Panel } from "@/shared/components/panel"
import { useEpisodeItems } from "../-hooks/use-episode-library"
import { siblingEpisodeId, type Episode } from "../-model"
import { EpisodeRow } from "./episode-row"

export type EpisodeListProps = {
  readonly selectedEpisodeId: string | undefined
  readonly onSelect: (episodeId: string | undefined) => void
}

/**
 * 一覧パネル全体。枠の中に行だけを収め、ツールバーを持たない。
 * 番組には絞り込む軸 (未読・保存) が無く、並びは生成順の1つだけなので、
 * 常設の操作列を置くと空の器が居座ることになる。
 */
export function EpisodeList({ onSelect, selectedEpisodeId }: EpisodeListProps) {
  return (
    <section
      aria-labelledby="episode-list-heading"
      className="flex min-h-full flex-col rounded-xl border bg-background"
    >
      {/* 日付見出し(h3)の親として見出し階層を繋ぐ。視覚には出さない。 */}
      <h2 className="sr-only" id="episode-list-heading">
        番組一覧
      </h2>
      <Panel fallback={<EpisodeListSkeleton />} name="episode-list">
        <ConnectedEpisodeList
          onSelect={onSelect}
          selectedEpisodeId={selectedEpisodeId}
        />
      </Panel>
    </section>
  )
}

function ConnectedEpisodeList({
  onSelect,
  selectedEpisodeId,
}: EpisodeListProps) {
  const items = useEpisodeItems()
  useEpisodeShortcuts({
    onNext: () =>
      onSelect(siblingEpisodeId(items.episodes, selectedEpisodeId, 1)),
    onPrev: () =>
      onSelect(siblingEpisodeId(items.episodes, selectedEpisodeId, -1)),
  })

  if (items.episodes.length === 0) return <EmptyLibrary />

  return (
    <div className="flex flex-1 flex-col">
      {items.groups.map((group) => (
        <section aria-labelledby={`episode-group-${group.key}`} key={group.key}>
          <h3
            className="sticky top-[var(--app-bar-h)] z-10 border-b border-border/60 bg-background/70 px-3 py-1.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-xl lg:top-0"
            id={`episode-group-${group.key}`}
          >
            {group.label}
          </h3>
          <ul>
            {group.episodes.map((episode) => (
              <EpisodeRow
                episode={episode}
                isSelected={episode.id === selectedEpisodeId}
                key={episode.id}
                onSelect={(selected: Episode) => onSelect(selected.id)}
              />
            ))}
          </ul>
        </section>
      ))}
      <LoadMoreSentinel
        fetchNextPage={items.fetchNextPage}
        hasNextPage={items.hasNextPage}
        isFetchNextPageError={items.isFetchNextPageError}
        isFetchingNextPage={items.isFetchingNextPage}
      />
    </div>
  )
}

function EmptyLibrary() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Library aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>完成した番組はまだありません</EmptyTitle>
        <EmptyDescription>
          「今日」から最初のニュース番組を生成すると、音声と台本がここに並びます。
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** j/kで番組を送る。記事一覧と同じ操作にする。 */
function useEpisodeShortcuts(handlers: {
  readonly onNext: () => void
  readonly onPrev: () => void
}) {
  const onKey = useEffectEvent((key: string) => {
    if (key === "j") handlers.onNext()
    if (key === "k") handlers.onPrev()
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return
      }
      onKey(event.key)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}

const SKELETON_TITLE_WIDTHS = [
  "w-[88%]",
  "w-[70%]",
  "w-[81%]",
  "w-[64%]",
  "w-[76%]",
] as const

/** 行と同じ骨格・同じ余白で描き、届いた瞬間に一覧の高さが飛ばないようにする。 */
export function EpisodeListSkeleton() {
  return (
    <div
      aria-label="番組を読み込み中"
      className="flex flex-1 flex-col"
      role="status"
    >
      <div className="border-b border-border/60 px-3 py-1.5">
        <Skeleton className="h-3 w-16" />
      </div>
      {SKELETON_TITLE_WIDTHS.map((width) => (
        <div
          className="flex items-center gap-1 border-b border-border/60 pr-2 pl-1"
          key={width}
        >
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex min-h-11 flex-1 flex-col justify-center gap-1.5 py-2">
            <Skeleton className={`h-4 ${width}`} />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 末尾に近づいたら続きを取る。非対応環境ではボタンで補う。
 *
 * 続きの取得失敗は`Panel`まで上がらない (初回のデータは既に描けている)。
 * 黙って止まると「これで全部」と読めてしまうので、ここで理由を出して
 * 同じ場所から再試行させる。自動の追い取得は失敗している間だけ止める。
 */
function LoadMoreSentinel({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  fetchNextPage,
}: {
  readonly hasNextPage: boolean
  readonly isFetchingNextPage: boolean
  readonly isFetchNextPageError: boolean
  readonly fetchNextPage: () => void
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  // 依存に入れるとobserverを張り直すことになり、既に交差している要素へ
  // もう一度通知が走って同じcursorを二度要求してしまう (ADR-0047)。
  const loadMore = useEffectEvent(() => {
    if (isFetchingNextPage) return
    fetchNextPage()
  })

  useEffect(() => {
    const node = sentinelRef.current
    if (
      !node ||
      !hasNextPage ||
      isFetchNextPageError ||
      typeof IntersectionObserver === "undefined"
    ) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: "400px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchNextPageError])

  if (!hasNextPage) return null

  return (
    <div className="flex flex-col items-center gap-2 p-3" ref={sentinelRef}>
      {isFetchNextPageError ? (
        <p className="text-sm text-destructive" role="alert">
          続きを読み込めませんでした
        </p>
      ) : null}
      {isFetchingNextPage ? (
        <Spinner aria-label="続きを読み込み中" />
      ) : (
        <Button onClick={() => loadMore()} size="sm" variant="outline">
          {isFetchNextPageError ? "再試行" : "もっと読み込む"}
        </Button>
      )}
    </div>
  )
}
