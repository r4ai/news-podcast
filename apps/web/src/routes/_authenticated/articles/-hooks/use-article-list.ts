import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react"
import { toast } from "@workspace/ui/components/sonner"

import { api } from "@/shared/api"
import { isFeedSyncActive } from "@/features/subscriptions"
import { createActionQueue } from "@/shared/lib/action-queue"
import {
  articleFacetsQueryOptions,
  articlesInfiniteQueryOptions,
  refetchArticleCollections,
  writeArticleToCaches,
} from "../-queries"
import {
  groupArticlesByDate,
  toBulkFilter,
  type Article,
  type ArticlePage,
  type ArticleSort,
  type ArticleState,
  type ArticlesSearch,
} from "../-model"

type ArticlePatch = {
  readonly read?: boolean
  readonly saved?: boolean
  readonly readLater?: boolean
}
type Draft = { readonly id: string; readonly patch: ArticlePatch }

/** 楽観適用は純粋なreducerとして切り出し、環境非依存にテストする。 */
export function applyDraft(
  articles: readonly Article[],
  draft: Draft
): readonly Article[] {
  return articles.map((article) =>
    article.id === draft.id ? { ...article, ...draft.patch } : article
  )
}

const SEARCH_DEBOUNCE_MS = 300
/** 同期中の追い取得。1秒ポーリングは一覧全ページを叩くので、間隔を緩める。 */
const SYNC_POLL_MS = 2_000

export type UseArticleListParams = {
  readonly search: ArticlesSearch
  readonly onSearchChange: (
    patch: Partial<ArticlesSearch>,
    options?: { readonly replace?: boolean }
  ) => void
}

export function useArticleList({
  search,
  onSearchChange,
}: UseArticleListParams) {
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()
  // 連打を投入順へ直列化する。hookの生存期間で1本だけ持つ。
  const enqueueRef = useRef(createActionQueue())

  const syncJobsQuery = api.useQuery(
    "get",
    "/v1/me/feed-sync-jobs",
    undefined,
    {
      refetchInterval: (query) =>
        query.state.data?.items.some(isFeedSyncActive) ? 1_000 : false,
    }
  )
  const syncActive = syncJobsQuery.data?.items.some(isFeedSyncActive) ?? false
  const wasSyncActive = useRef(false)

  const listQuery = useInfiniteQuery({
    ...articlesInfiniteQueryOptions(search),
    // 続きを読み込んだ後は再取得が全ページに及ぶので、先頭ページの間だけ追う。
    refetchInterval: (query) =>
      syncActive && (query.state.data?.pages.length ?? 0) <= 1
        ? SYNC_POLL_MS
        : false,
  })

  const facetsQuery = useQuery({
    ...articleFacetsQueryOptions(search),
    staleTime: 30_000,
  })

  const patchMutation = api.useMutation("patch", "/v1/me/articles/{articleId}")
  const bulkMutation = api.useMutation("post", "/v1/me/articles/bulk-state")

  const serverItems = useMemo(
    () =>
      (listQuery.data?.pages ?? []).flatMap(
        (page: ArticlePage) => page.items
      ) as Article[],
    [listQuery.data]
  )
  const [articles, addDraft] = useOptimistic(serverItems, applyDraft)
  const groups = useMemo(() => groupArticlesByDate(articles), [articles])

  useEffect(() => {
    const wasActive = wasSyncActive.current
    wasSyncActive.current = syncActive
    if (!wasActive || syncActive) return
    void refetchArticleCollections(queryClient)
  }, [queryClient, syncActive])

  const update = useCallback(
    (article: Article, next: ArticlePatch) => {
      startTransition(async () => {
        addDraft({ id: article.id, patch: next })
        try {
          const updated = await enqueueRef.current(() =>
            patchMutation.mutateAsync({
              params: { path: { articleId: article.id } },
              body: next,
            })
          )
          // 応答は更新後の記事そのもの。該当行とfacetsだけ書き戻し、再取得しない。
          writeArticleToCaches(queryClient, {
            article: updated as Article,
            before: article,
            includeHidden: search.includeHidden,
          })
        } catch {
          toast.error("記事の状態を更新できませんでした")
        }
      })
    },
    [addDraft, patchMutation, queryClient, search.includeHidden]
  )

  function markAllRead() {
    startTransition(async () => {
      try {
        const result = await enqueueRef.current(() =>
          bulkMutation.mutateAsync({
            body: { ...toBulkFilter(search), read: true },
          })
        )
        // 一括更新は差分を数え切れないので、ここだけは取り直す。
        await refetchArticleCollections(queryClient)
        toast.success(`${result.updated}件を既読にしました`)
      } catch {
        toast.error("一括で既読にできませんでした")
      }
    })
  }

  // 検索欄はデバウンスしてからURLへ反映し、それ以外の絞り込みは即時にURLへ載せる。
  const [qDraft, setQDraft] = useState(search.q)
  const qTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => setQDraft(search.q), [search.q])
  useEffect(() => () => clearTimeout(qTimeoutRef.current), [])

  function setQ(value: string) {
    setQDraft(value)
    clearTimeout(qTimeoutRef.current)
    qTimeoutRef.current = setTimeout(() => {
      onSearchChange({ q: value }, { replace: true })
    }, SEARCH_DEBOUNCE_MS)
  }

  return {
    articles,
    groups,
    facets: facetsQuery.data,
    aiPending: facetsQuery.data?.aiPending,
    isLoading: listQuery.isPending,
    isError: listQuery.isError,
    isSyncing: syncActive,
    hasNextPage: listQuery.hasNextPage,
    isFetchingNextPage: listQuery.isFetchingNextPage,
    nextPageFailed: Boolean(listQuery.data) && listQuery.isError,
    fetchNextPage: () => void listQuery.fetchNextPage(),
    refetch: () => void listQuery.refetch(),
    search,
    q: qDraft,
    setQ,
    setState: (state: ArticleState) => onSearchChange({ state }),
    setSort: (sort: ArticleSort) => onSearchChange({ sort }),
    setFeedIds: (feedIds: readonly string[]) => onSearchChange({ feedIds }),
    setIncludeHidden: (includeHidden: boolean) =>
      onSearchChange({ includeHidden }),
    toggleSaved: (article: Article) =>
      update(article, { saved: !article.saved }),
    markRead: (article: Article) => update(article, { read: true }),
    markAllRead,
    isMarkingAllRead: bulkMutation.isPending,
  } as const
}
