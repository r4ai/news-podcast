import { useQueryClient, useSuspenseInfiniteQuery } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useEffect, useOptimistic, useRef, useTransition } from "react"

import { api } from "@/shared/api"
import { toast } from "@/shared/ui/toast"
import { articleFacetsAtomFamily, isSyncingAtom } from "../-atoms"
import {
  ARTICLE_STATE_MUTATION_SCOPE,
  articlesInfiniteQueryOptions,
  refetchArticleCollections,
  writeArticleToCaches,
} from "../-queries"
import {
  groupArticlesByDate,
  toBulkFilter,
  type Article,
  type ArticlePage,
  type ArticlesSearch,
} from "../-model"

/** 同期中の追い取得。1秒ポーリングは一覧全ページを叩くので、間隔を緩める。 */
const SYNC_POLL_MS = 2_000

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

/**
 * 記事一覧の本体。
 *
 * 件数(facets)と同期状態は**別のatom**なので、ここでは購読しない。1つのhookが
 * 全部を返してpropsで配ると、件数が1つ動いただけで記事行まで描き直される
 * (計測済み: 30行 × 1回)。購読の単位を分けるのがatomにした理由。
 */
export function useArticleItems(search: ArticlesSearch) {
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()

  const syncing = useAtomValue(isSyncingAtom)
  // 一覧の取得だけはTanStack Queryのsuspense hookのまま。`Panel`の表示・回復
  // 境界がsuspendする読みに依存しており、jotai側のsuspense atomはReact 19の
  // Suspenseで解決しないことを実測した (docs/adr参照)。
  const listQuery = useSuspenseInfiniteQuery({
    ...articlesInfiniteQueryOptions(search),
    // 続きを読み込んだ後は再取得が全ページに及ぶので、先頭ページの間だけ追う。
    refetchInterval: (query) =>
      syncing && (query.state.data?.pages.length ?? 0) <= 1
        ? SYNC_POLL_MS
        : false,
  })

  const serverItems = listQuery.data.pages.flatMap(
    (page: ArticlePage) => page.items
  ) as Article[]
  const [articles, addDraft] = useOptimistic(serverItems, applyDraft)
  const groups = groupArticlesByDate(articles)

  const patchMutation = api.useMutation(
    "patch",
    "/v1/me/articles/{articleId}",
    { scope: ARTICLE_STATE_MUTATION_SCOPE }
  )

  function update(article: Article, next: ArticlePatch) {
    startTransition(async () => {
      addDraft({ id: article.id, patch: next })
      try {
        const updated = await patchMutation.mutateAsync({
          params: { path: { articleId: article.id } },
          body: next,
        })
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
  }

  return {
    articles,
    groups,
    hasNextPage: listQuery.hasNextPage,
    isFetchingNextPage: listQuery.isFetchingNextPage,
    fetchNextPage: () => void listQuery.fetchNextPage(),
    toggleSaved: (article: Article) =>
      update(article, { saved: !article.saved }),
    markRead: (article: Article) => update(article, { read: true }),
  } as const
}

/**
 * 一覧ヘッダーが要る分だけ。件数と一括既読で、記事行の中身には触れない。
 */
export function useArticleListHeaderState(search: ArticlesSearch) {
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()
  const facetsQuery = useAtomValue(articleFacetsAtomFamily(search))

  const bulkMutation = api.useMutation("post", "/v1/me/articles/bulk-state", {
    scope: ARTICLE_STATE_MUTATION_SCOPE,
  })

  function markAllRead() {
    startTransition(async () => {
      try {
        const result = await bulkMutation.mutateAsync({
          body: { ...toBulkFilter(search), read: true },
        })
        // 一括更新は差分を数え切れないので、ここだけは取り直す。
        await refetchArticleCollections(queryClient)
        toast.success(`${result.updated}件を既読にしました`)
      } catch {
        toast.error("一括で既読にできませんでした")
      }
    })
  }

  return {
    facets: facetsQuery.data,
    aiPending: facetsQuery.data?.aiPending,
    markAllRead,
    isMarkingAllRead: bulkMutation.isPending,
  } as const
}

/**
 * RSS同期の進行。真偽値だけを購読するので、ジョブの中身が動いても
 * ここを読むcomponentは描き直されない。
 */
export function useFeedSyncIndicator() {
  const queryClient = useQueryClient()
  const syncActive = useAtomValue(isSyncingAtom)
  const wasSyncActive = useRef(false)

  // 外部のフィード同期ジョブが終わった瞬間に、取り込まれた記事を取り直す。
  // stateのミラーではなく「外部システムの完了への反応」なのでEffectで扱う。
  useEffect(() => {
    const wasActive = wasSyncActive.current
    wasSyncActive.current = syncActive
    if (!wasActive || syncActive) return
    void refetchArticleCollections(queryClient)
  }, [queryClient, syncActive])

  return syncActive
}
