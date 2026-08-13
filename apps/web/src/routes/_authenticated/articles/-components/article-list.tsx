import { Newspaper, SearchX } from "lucide-react"
import { useEffect, useRef, useState } from "react"

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

import { useArticleList } from "../-hooks/use-article-list"
import { type Article, type ArticlesSearch } from "../-model"
import { ArticleDateGroup } from "./article-date-group"
import { ArticleToolbar, ArticleToolbarSticky } from "./article-toolbar"

export type ArticleListProps = {
  readonly list: ReturnType<typeof useArticleList>
  readonly selectedArticleId: string | undefined
  readonly onSelect: (article: Article) => void
  readonly onShowEnrichQueue: () => void
}

export function ArticleList({
  list,
  selectedArticleId,
  onSelect,
  onShowEnrichQueue,
}: ArticleListProps) {
  const [searchExpanded, setSearchExpanded] = useState(false)

  function toggleSearch() {
    setSearchExpanded((prev) => !prev)
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArticleToolbarSticky
        facets={list.facets}
        onStateChange={list.setState}
        onToggleSearch={toggleSearch}
        search={list.search}
        searchExpanded={searchExpanded}
      />
      <ArticleToolbar
        aiPending={list.aiPending}
        facets={list.facets}
        isMarkingAllRead={list.isMarkingAllRead}
        onFeedIdsChange={list.setFeedIds}
        onIncludeHiddenChange={list.setIncludeHidden}
        onMarkAllRead={list.markAllRead}
        onQChange={list.setQ}
        onShowEnrichQueue={onShowEnrichQueue}
        onSortChange={list.setSort}
        onToggleSearch={toggleSearch}
        q={list.q}
        search={list.search}
        searchExpanded={searchExpanded}
      />
      <ArticleListView
        {...list}
        onSelect={onSelect}
        selectedArticleId={selectedArticleId}
      />
    </div>
  )
}

export type ArticleListViewProps = ReturnType<typeof useArticleList> & {
  readonly onSelect: (article: Article) => void
  readonly selectedArticleId: string | undefined
}

function emptyStateCopy(search: ArticlesSearch) {
  if (search.q.trim()) {
    return {
      title: "検索に一致する記事がありません",
      description: `「${search.q}」に一致する記事は見つかりませんでした。`,
      icon: SearchX,
    }
  }
  const filtered = search.feedIds.length > 0 || search.state !== "all"
  return filtered
    ? {
        title: "条件に一致する記事がありません",
        description: "絞り込みを変更すると、他の記事が表示されます。",
        icon: SearchX,
      }
    : {
        title: "表示できる記事がありません",
        description: "RSSを購読すると、同期された記事がここに表示されます。",
        icon: Newspaper,
      }
}

function LoadingSkeleton() {
  return (
    <div
      aria-label="記事を読み込み中"
      className="flex flex-col gap-px"
      role="status"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          className="flex items-center gap-3 border-b px-3 py-2.5"
          key={index}
        >
          <Skeleton className="size-1.5 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** IntersectionObserverで末尾検知し、自動でfetchNextPageする。非対応環境ではボタンで補う。 */
function LoadMoreSentinel({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: Pick<
  ArticleListViewProps,
  "hasNextPage" | "isFetchingNextPage" | "fetchNextPage"
>) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage || typeof IntersectionObserver === "undefined") {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, fetchNextPage])

  if (!hasNextPage) return null

  return (
    <div className="flex justify-center py-3" ref={sentinelRef}>
      {isFetchingNextPage ? (
        <Spinner aria-label="続きを読み込み中" />
      ) : (
        <Button onClick={fetchNextPage} size="sm" variant="outline">
          もっと読み込む
        </Button>
      )}
    </div>
  )
}

export function ArticleListView({
  articles,
  groups,
  search,
  isLoading,
  isError,
  refetch,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  toggleSaved,
  onSelect,
  selectedArticleId,
}: ArticleListViewProps) {
  if (isLoading) return <LoadingSkeleton />

  if (isError && articles.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>記事を取得できませんでした</EmptyTitle>
          <EmptyDescription>
            通信状況を確認してから、もう一度お試しください。
          </EmptyDescription>
        </EmptyHeader>
        <Button onClick={refetch} size="sm" variant="outline">
          再読み込み
        </Button>
      </Empty>
    )
  }

  if (articles.length === 0) {
    const empty = emptyStateCopy(search)
    const Icon = empty.icon
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{empty.title}</EmptyTitle>
          <EmptyDescription>{empty.description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-background">
      {groups.map((group) => (
        <ArticleDateGroup
          group={group}
          key={`${group.key}-${group.articles[0]?.id}`}
          onSelect={onSelect}
          onToggleSaved={toggleSaved}
          selectedArticleId={selectedArticleId}
          showHeader
        />
      ))}
      <LoadMoreSentinel
        fetchNextPage={fetchNextPage}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
      />
    </div>
  )
}
