import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { paths } from "@news-podcast/contracts/openapi"

import { fetchClient } from "@/shared/api"

import { MAX_SELECTED_ARTICLES } from "../model"

const PAGE_SIZE = 30
const EMPTY_SELECTION: readonly string[] = []
type ArticleListQuery = NonNullable<
  paths["/v1/me/articles"]["get"]["parameters"]["query"]
>

const ARTICLE_PICKER_QUERY = {
  state: "all",
  sort: "newest",
  limit: String(PAGE_SIZE),
} satisfies ArticleListQuery

/**
 * 生成ダイアログの候補一覧と選択状態。
 *
 * 候補は既存の `/v1/me/articles` を使う。記事一覧APIにはアーカイブ状態の
 * 絞り込みがないため、一覧を新しい順で取得して、エージェントが読める
 * アーカイブ済みの記事だけを候補に残す。
 */
export function useArticlePicker(
  enabled: boolean,
  initialSelectedIds: readonly string[] = EMPTY_SELECTION
) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])

  const syncedKeyRef = useRef<string>("")

  useEffect(() => {
    if (!enabled) return
    // 参照ではなく値で比較し、同一内容ならスキップして再レンダーの連鎖を防ぐ。
    const key = initialSelectedIds.join(",")
    if (key === syncedKeyRef.current) return
    syncedKeyRef.current = key
    setSelectedIds([...initialSelectedIds])
  }, [enabled, initialSelectedIds])

  const listQuery = useInfiniteQuery({
    ...infiniteQueryOptions({
      queryKey: ["article-picker", ARTICLE_PICKER_QUERY] as const,
      queryFn: async ({ pageParam, signal }) => {
        const { data, error } = await fetchClient.GET("/v1/me/articles", {
          signal,
          params: {
            query: {
              ...ARTICLE_PICKER_QUERY,
              ...(pageParam === undefined ? {} : { cursor: pageParam }),
            },
          },
        })
        if (error) throw error
        return data
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) =>
        last.page.hasMore ? last.page.nextCursor : undefined,
    }),
    enabled,
  })

  const articles = useMemo(
    () =>
      (listQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .filter((article) => article.archiveStatus === "succeeded"),
    [listQuery.data]
  )

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const atLimit = selectedIds.length >= MAX_SELECTED_ARTICLES

  // 候補一覧を読み切った時点で、どのページにも現れなかった選択IDを外す。
  // 購読停止やアーカイブ失敗で選べなくなった記事を再生成対象に送る事故を防ぐ。
  const loadedIds = useMemo(
    () => new Set(articles.map((article) => article.id)),
    [articles]
  )
  useEffect(() => {
    if (!enabled) return
    if (listQuery.isLoading) return
    if (listQuery.hasNextPage !== false) return
    setSelectedIds((current) => {
      const filtered = current.filter((id) => loadedIds.has(id))
      return filtered.length !== current.length ? filtered : current
    })
  }, [enabled, loadedIds, listQuery.isLoading, listQuery.hasNextPage])

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
