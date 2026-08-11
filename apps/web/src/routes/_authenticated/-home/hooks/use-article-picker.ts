import { useCallback, useMemo, useState } from "react"

import { type Article } from "@/features/articles"
import { api } from "@/shared/api"

import { MAX_SELECTED_ARTICLES } from "../model"

const PAGE_SIZE = 30

/**
 * 生成ダイアログの候補一覧と選択状態。
 *
 * 候補は既存の `/v1/me/articles` をそのまま使う。アーカイブ済みだけが
 * エージェントの読める記事なので `archiveStatus` で絞り、おすすめ順で
 * 上から選べるようにする。
 */
export function useArticlePicker(enabled: boolean) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])

  const listQuery = api.useInfiniteQuery(
    "get",
    "/v1/me/articles",
    {
      params: {
        query: {
          archiveStatus: ["succeeded"],
          sort: "relevance",
          limit: PAGE_SIZE,
        },
      },
    },
    {
      enabled,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) =>
        last.page.hasMore ? last.page.nextCursor : undefined,
    }
  )

  const articles = useMemo(
    () =>
      (listQuery.data?.pages ?? []).flatMap(
        (page) => page.items as readonly Article[]
      ),
    [listQuery.data]
  )

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const atLimit = selectedIds.length >= MAX_SELECTED_ARTICLES

  const toggle = useCallback(
    (articleId: string) => {
      setSelectedIds((current) =>
        current.includes(articleId)
          ? current.filter((id) => id !== articleId)
          : current.length >= MAX_SELECTED_ARTICLES
            ? current
            : [...current, articleId]
      )
    },
    [setSelectedIds]
  )

  const clear = useCallback(() => setSelectedIds([]), [])

  /** 読み込み済みの候補を上限まで選ぶ。上限を超える分は切り捨てる。 */
  const selectTop = useCallback(() => {
    setSelectedIds(
      articles.slice(0, MAX_SELECTED_ARTICLES).map((article) => article.id)
    )
  }, [articles])

  return {
    articles,
    selectedIds,
    selected,
    atLimit,
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    hasNextPage: listQuery.hasNextPage,
    isFetchingNextPage: listQuery.isFetchingNextPage,
    onLoadMore: () => void listQuery.fetchNextPage(),
    onRetry: () => void listQuery.refetch(),
    onToggle: toggle,
    onSelectTop: selectTop,
    onClear: clear,
  } as const
}
