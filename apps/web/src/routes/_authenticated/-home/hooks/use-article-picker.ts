import {
  infiniteQueryOptions,
  keepPreviousData,
  useInfiniteQuery,
} from "@tanstack/react-query"
import { useDeferredValue, useEffect, useRef, useState } from "react"

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
 * 絞り込みがないため、一覧を新しい順で取得して、生成処理が読める
 * アーカイブ済みの記事だけを候補に残す。
 */
export function useArticlePicker(
  enabled: boolean,
  initialSelectedIds: readonly string[] = EMPTY_SELECTION
) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const normalizedSearchQuery = searchQuery.trim()
  const deferredSearchQuery = useDeferredValue(normalizedSearchQuery)
  const initialSelectionKey = initialSelectedIds.join(",")
  const initialSelectedIdsRef = useRef(initialSelectedIds)
  initialSelectedIdsRef.current = initialSelectedIds

  useEffect(() => {
    if (!enabled) return
    // `enabled`のfalse→trueが選択セッションの境界。同じ初期値でも、開く
    // たびにキャンセル前の編集を捨ててfresh/retry双方の契約へ戻す。依存は
    // UUID列の値へ狭め、呼び出し側の配列参照だけが変わっても再実行しない。
    setSelectedIds([...initialSelectedIdsRef.current])
  }, [enabled, initialSelectionKey])

  const requestQuery = {
    ...ARTICLE_PICKER_QUERY,
    ...(deferredSearchQuery === "" ? {} : { q: deferredSearchQuery }),
  } satisfies ArticleListQuery

  const listQuery = useInfiniteQuery({
    ...infiniteQueryOptions({
      queryKey: ["article-picker", requestQuery] as const,
      queryFn: async ({ pageParam, signal }) => {
        const { data, error } = await fetchClient.GET("/v1/me/articles", {
          signal,
          params: {
            query: {
              ...requestQuery,
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
      placeholderData: keepPreviousData,
    }),
    enabled,
  })

  const articles = (listQuery.data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((article) => article.archiveStatus === "succeeded")

  const selected = new Set(selectedIds)
  const atLimit = selectedIds.length >= MAX_SELECTED_ARTICLES
  const isSearching =
    normalizedSearchQuery !== "" &&
    (normalizedSearchQuery !== deferredSearchQuery || listQuery.isFetching)

  // 候補一覧を読み切った時点で、候補に出ていない選択IDを外す。購読停止で
  // 消えた記事だけでなく、記事は残っていてもアーカイブがpending/failedで
  // 選べない記事も落とす。見えないIDを送ると同じ失敗を繰り返す。
  // 判定に使う集合はEffectの中で組み立てる。毎render新しいSetを依存に置くと、
  // 中身が同じでも実行され続ける。
  const pages = listQuery.data?.pages
  useEffect(() => {
    if (!enabled) return
    if (deferredSearchQuery !== "") return
    if (listQuery.isLoading) return
    if (listQuery.hasNextPage !== false) return
    // 画面に出ている候補と同じ条件で絞る (`articles`と同一の判定)。
    const loadedIds = new Set(
      (pages ?? [])
        .flatMap((page) => page.items)
        .filter((article) => article.archiveStatus === "succeeded")
        .map((article) => article.id)
    )
    setSelectedIds((current) => {
      const filtered = current.filter((id) => loadedIds.has(id))
      return filtered.length !== current.length ? filtered : current
    })
  }, [
    deferredSearchQuery,
    enabled,
    pages,
    listQuery.isLoading,
    listQuery.hasNextPage,
  ])

  function toggle(articleId: string) {
    setSelectedIds((current) =>
      current.includes(articleId)
        ? current.filter((id) => id !== articleId)
        : current.length >= MAX_SELECTED_ARTICLES
          ? current
          : [...current, articleId]
    )
  }

  function clear() {
    setSelectedIds([])
  }

  /** 読み込み済みの候補を上限まで選ぶ。上限を超える分は切り捨てる。 */
  function selectTop() {
    setSelectedIds(
      articles.slice(0, MAX_SELECTED_ARTICLES).map((article) => article.id)
    )
  }

  return {
    articles,
    searchQuery,
    hasSearchQuery: normalizedSearchQuery !== "",
    isSearching,
    selectedIds,
    selected,
    atLimit,
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    hasNextPage: isSearching ? false : listQuery.hasNextPage,
    isFetchingNextPage: listQuery.isFetchingNextPage,
    onLoadMore: () => void listQuery.fetchNextPage(),
    onRetry: () => void listQuery.refetch(),
    onSearchChange: setSearchQuery,
    onToggle: toggle,
    onSelectTop: selectTop,
    onClear: clear,
  } as const
}
