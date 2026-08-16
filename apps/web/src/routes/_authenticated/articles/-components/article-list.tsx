import { LoaderCircle, Newspaper, SearchX } from "lucide-react"
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

import { useArticleKeyboardShortcuts } from "../-hooks/use-article-keyboard-shortcuts"
import {
  useArticleItems,
  useFeedSyncIndicator,
} from "../-hooks/use-article-list"
import { siblingArticleId, type Article, type ArticlesSearch } from "../-model"
import { ArticleDateGroup } from "./article-date-group"
import { ARTICLE_HEADER_HEIGHT, ArticleListHeader } from "./article-list-header"

export type ArticleListProps = {
  readonly search: ArticlesSearch
  readonly onSearchChange: (
    patch: Partial<ArticlesSearch>,
    options?: { readonly replace?: boolean }
  ) => void
  readonly selectedArticleId: string | undefined
  readonly onSelect: (articleId: string | undefined) => void
}

/**
 * 一覧パネル全体。ツールバーと行を1つの枠の中へ収め、枠線が行だけを囲って
 * 浮く状態を無くす。
 *
 * ここ自身はserver stateを一切購読しない。購読は「その値を実際に描く場所」
 * まで下ろしてある。ここで受け取って配ると、件数が動いただけで記事行まで
 * 描き直される。
 */
export function ArticleList({
  search,
  onSearchChange,
  selectedArticleId,
  onSelect,
}: ArticleListProps) {
  return (
    <section
      aria-labelledby="article-list-heading"
      // stickyの基準になる高さはここで一度だけ宣言し、ヘッダーと日付見出しが
      // 同じ値を見るようにする。`overflow-hidden`はstickyを殺すので使わない。
      className={`flex min-h-full flex-col rounded-xl border bg-background ${ARTICLE_HEADER_HEIGHT}`}
    >
      {/* 日付見出し(h3)の親として見出し階層を繋ぐ。視覚には出さない。 */}
      <h2 className="sr-only" id="article-list-heading">
        記事一覧
      </h2>
      <ArticleListHeader onSearchChange={onSearchChange} search={search} />
      <SyncBanner />
      <ConnectedArticleListView
        onSelect={onSelect}
        search={search}
        selectedArticleId={selectedArticleId}
      />
    </section>
  )
}

/** 同期中かどうかだけを購読する。ジョブの中身が動いても描き直されない。 */
function SyncBanner() {
  const syncing = useFeedSyncIndicator()
  if (!syncing) return null

  return (
    <p
      aria-live="polite"
      className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      role="status"
    >
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      RSSを同期中です。記事一覧は完了すると自動更新されます。
    </p>
  )
}

export type ArticleListViewProps = {
  readonly articles: readonly Article[]
  readonly groups: ReturnType<typeof useArticleItems>["groups"]
  readonly search: ArticlesSearch
  readonly hasNextPage: boolean
  readonly isFetchingNextPage: boolean
  readonly fetchNextPage: () => void
  readonly toggleSaved: (article: Article) => void
  readonly onSelect: (article: Article) => void
  readonly selectedArticleId: string | undefined
}

/**
 * データ接続。記事の中身が変わったときだけ描き直される。
 * j/kの送りもここに置く。対象になる並びを持っているのがここだから。
 */
function ConnectedArticleListView({
  search,
  onSelect,
  selectedArticleId,
}: {
  readonly search: ArticlesSearch
  readonly onSelect: (articleId: string | undefined) => void
  readonly selectedArticleId: string | undefined
}) {
  const items = useArticleItems(search)

  useArticleKeyboardShortcuts({
    focusSearchOnSlash: true,
    onNext: () =>
      onSelect(siblingArticleId(items.articles, selectedArticleId, 1)),
    onPrev: () =>
      onSelect(siblingArticleId(items.articles, selectedArticleId, -1)),
  })

  return (
    <ArticleListView
      articles={items.articles}
      fetchNextPage={items.fetchNextPage}
      groups={items.groups}
      hasNextPage={items.hasNextPage}
      isFetchingNextPage={items.isFetchingNextPage}
      onSelect={(article: Article) => onSelect(article.id)}
      search={search}
      selectedArticleId={selectedArticleId}
      toggleSaved={items.toggleSaved}
    />
  )
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

/** Panelのfallbackとして使う。行の形に合わせ、切り替わりで高さが飛ばないようにする。 */
export function ArticleListSkeleton() {
  return (
    <div aria-label="記事を読み込み中" className="flex flex-col" role="status">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="flex items-start gap-2 border-b px-3 py-3" key={index}>
          <Skeleton className="mt-1.5 size-1.5 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
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

  // 通知の処理には「その時点の最新の取得関数と進捗」が要るが、それらを依存に
  // 入れるとobserverを張り直すことになる。張り直すと、既に交差している要素へ
  // もう一度通知が走り、同じcursorを二度要求してしまう。非リアクティブに
  // 保つことで、observerの寿命を`hasNextPage`だけに縛る (ADR-0047)。
  const loadMore = useEffectEvent(() => {
    if (isFetchingNextPage) return
    fetchNextPage()
  })

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage || typeof IntersectionObserver === "undefined") {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      // 末尾に届く手前で読み始め、スクロールが止まる時間を減らす。
      { rootMargin: "400px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage])

  if (!hasNextPage) return null

  return (
    <div className="flex justify-center p-3" ref={sentinelRef}>
      {isFetchingNextPage ? (
        <Spinner aria-label="続きを読み込み中" />
      ) : (
        <Button onClick={() => loadMore()} size="sm" variant="outline">
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
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  toggleSaved,
  onSelect,
  selectedArticleId,
}: ArticleListViewProps) {
  // 初回の読み込みと取得失敗はPanel (Suspense + CatchBoundary) が扱う。
  // ここは「取れたが0件」だけを描き分ける。
  if (articles.length === 0) {
    const empty = emptyStateCopy(search)
    const Icon = empty.icon
    return (
      <Empty className="flex-1">
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
    <div className="flex flex-1 flex-col">
      {groups.map((group) => (
        <ArticleDateGroup
          group={group}
          key={group.key}
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
