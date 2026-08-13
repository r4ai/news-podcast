import { useQueryClient } from "@tanstack/react-query"
import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react"
import { toast } from "@workspace/ui/components/sonner"

import { api } from "@/shared/api"
import {
  groupArticlesByDate,
  toBulkFilter,
  toFacetsQuery,
  toListQuery,
  type Article,
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
const PAGE_SIZE = 50

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

  const listQuery = api.useInfiniteQuery(
    "get",
    "/v1/me/articles",
    { params: { query: { ...toListQuery(search), limit: String(PAGE_SIZE) } } },
    {
      initialPageParam: undefined as string | undefined,
      getNextPageParam: () => undefined,
    }
  )

  const facetsQuery = api.useQuery("get", "/v1/me/articles/facets", {
    params: { query: toFacetsQuery(search) },
  })

  const patchMutation = api.useMutation("patch", "/v1/me/articles/{articleId}")
  const bulkMutation = api.useMutation("post", "/v1/me/articles/bulk-state")

  const serverItems = useMemo(
    () =>
      (listQuery.data?.pages ?? []).flatMap((page) => page.items) as Article[],
    [listQuery.data]
  )
  const [items, addDraft] = useOptimistic(serverItems, applyDraft)
  const articles = items

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["get", "/v1/me/articles"] }),
      queryClient.invalidateQueries({
        queryKey: ["get", "/v1/me/articles/facets"],
      }),
    ])
  }

  function update(article: Article, next: ArticlePatch) {
    startTransition(async () => {
      addDraft({ id: article.id, patch: next })
      try {
        await patchMutation.mutateAsync({
          params: { path: { articleId: article.id } },
          body: next,
        })
        await invalidate()
      } catch {
        toast.error("記事の状態を更新できませんでした")
      }
    })
  }

  function markAllRead() {
    startTransition(async () => {
      try {
        const result = await bulkMutation.mutateAsync({
          body: { ...toBulkFilter(search), read: true },
        })
        await invalidate()
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
    groups: groupArticlesByDate(articles),
    facets: facetsQuery.data,
    aiPending: facetsQuery.data?.aiPending,
    isLoading: listQuery.isPending,
    isError: listQuery.isError,
    hasNextPage: listQuery.hasNextPage ?? false,
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
