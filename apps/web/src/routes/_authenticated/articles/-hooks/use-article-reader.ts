import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react"
import { toast } from "@/shared/ui/toast"

import { api } from "@/shared/api"
import { usePreloadMarkdownProcessor } from "@/shared/markdown"
import {
  ARTICLE_STATE_MUTATION_SCOPE,
  articleMarkdownQueryOptions,
  articleReplayQueryOptions,
  articleQueryOptions,
  refetchArticleCollections,
  writeArticleToCaches,
} from "../-queries"
import {
  shouldFallbackToArchive,
  type Article,
  type ArticleSource,
} from "../-model"

type ArticlePatch = {
  readonly read?: boolean
  readonly saved?: boolean
  readonly readLater?: boolean
  readonly hidden?: boolean
}

function applyPatch(article: Article, patch: ArticlePatch): Article {
  return { ...article, ...patch }
}

export type UseArticleReaderParams = {
  readonly articleId: string
  /** 一覧の`includeHidden`。非表示にした記事を一覧から外すかの判断に使う。 */
  readonly includeHidden?: boolean
}

/**
 * 選択中の記事の詳細取得・本文取得・状態更新をまとめるhook。
 * viewはpropsだけを受け取る (ADR-0018)。
 *
 * 「別の記事」は別のコンポーネントインスタンスなので、呼び出し側が
 * `key={articleId}` でマウントし直す。記事が変わるたびにEffectで
 * ローカルstateを消して回る必要はなく、unmount時のcleanupも1本で足りる。
 */
export function useArticleReader({
  articleId,
  includeHidden = false,
}: UseArticleReaderParams) {
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()

  // 本文のコンパイル器は遅延読み込みなので、本文の取得と重ねて取りに行く。
  // 直列にすると、遅延にした分がそのまま表示の遅れになる。
  usePreloadMarkdownProcessor()

  const { data: serverArticle } = useSuspenseQuery(
    articleQueryOptions(articleId)
  )
  // 本文はSuspenseに載せない。取得失敗は「アーカイブ表示へ落とす」という
  // 正常な分岐であって、リーダーごと落とすべき欠陥ではない。
  const markdownQuery = useQuery(articleMarkdownQueryOptions(articleId))

  const [userSource, setUserSource] = useState<ArticleSource | undefined>(
    undefined
  )

  const autoFallback =
    !markdownQuery.isLoading &&
    shouldFallbackToArchive({
      markdown: markdownQuery.data,
      isError: markdownQuery.isError,
    })
  const source: ArticleSource =
    userSource ?? (autoFallback ? "archive" : "markdown")
  const didAutoFallback = userSource === undefined && autoFallback
  const snapshotId = serverArticle.snapshotId
  const replayQuery = useQuery({
    ...articleReplayQueryOptions(snapshotId ?? "missing"),
    enabled: source === "archive" && snapshotId !== undefined,
  })

  const [article, addDraft] = useOptimistic(serverArticle, applyPatch)

  const patchMutation = api.useMutation(
    "patch",
    "/v1/me/articles/{articleId}",
    {
      scope: ARTICLE_STATE_MUTATION_SCOPE,
    }
  )
  const enrichMutation = api.useMutation(
    "post",
    "/v1/me/articles/{articleId}/enrich"
  )

  function settle(before: Article, updated: Article) {
    writeArticleToCaches(queryClient, {
      article: updated,
      before,
      includeHidden,
    })
  }

  function update(patch: ArticlePatch, errorMessage: string) {
    const target = article
    startTransition(async () => {
      addDraft(patch)
      try {
        const updated = await patchMutation.mutateAsync({
          params: { path: { articleId: target.id } },
          body: patch,
        })
        settle(target, updated as Article)
      } catch {
        toast.error(errorMessage)
      }
    })
  }

  // 開いた未読記事は、離脱する瞬間に既読へ送る。読み終える前に閉じた場合も
  // 既読にしたいので、記録は開いた時点で行い、送信はcleanupで行う。
  const [userUnread, setUserUnread] = useState(false)

  // 送信内容は「離脱した時点の最新」を見たいが、Effectの再実行は起こしたく
  // ない。renderではなくcommitごとにrefを差し替えることで、cleanupから最新の
  // 記事状態を読めるようにする (useEffectEventはcleanupから呼べない)。
  const flushReadRef = useRef<() => void>(() => {})
  useEffect(() => {
    flushReadRef.current = () => {
      if (article.read || userUnread) return
      patchMutation
        .mutateAsync({
          params: { path: { articleId: article.id } },
          body: { read: true },
        })
        .then((updated) => settle(article, updated as Article))
        .catch(() => toast.error("既読にできませんでした"))
    }
  })

  // 記事を離れる瞬間 (切り替え・一覧へ戻る・unmount) にフラッシュする。
  useEffect(() => () => flushReadRef.current(), [])

  // タブを閉じる・別ページへ移動する場合も同じく既読へ送る。
  useEffect(() => {
    function onPageHide() {
      flushReadRef.current()
    }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [])

  const markUnread = () => {
    setUserUnread(true)
    update({ read: false }, "未読に戻せませんでした")
  }

  async function recalculateAi() {
    const target = article
    try {
      await enrichMutation.mutateAsync({
        params: { path: { articleId: target.id } },
      })
      // AI要約と適合度はサーバ側で作り直されるので、ここは取り直すしかない。
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: articleQueryOptions(target.id).queryKey,
        }),
        refetchArticleCollections(queryClient),
      ])
      toast.success("AI要約と適合度スコアを再計算しました")
    } catch {
      toast.error("AIの再計算に失敗しました")
    }
  }

  return {
    articleId,
    article,
    source,
    setSource: setUserSource,
    didAutoFallback,
    markdown: markdownQuery.data,
    isMarkdownLoading: markdownQuery.isLoading,
    archiveUrl: replayQuery.data,
    isArchiveLoading:
      source === "archive" && snapshotId !== undefined && replayQuery.isPending,
    archiveUnavailable:
      source === "archive" && (snapshotId === undefined || replayQuery.isError),
    retryArchive: async () => {
      await replayQuery.refetch()
    },
    toggleSaved: () =>
      update({ saved: !article.saved }, "保存状態を更新できませんでした"),
    toggleReadLater: () =>
      update(
        { readLater: !article.readLater },
        "あとで読むを更新できませんでした"
      ),
    toggleHidden: () =>
      update({ hidden: !article.hidden }, "非表示を更新できませんでした"),
    markUnread,
    recalculateAi,
    isRecalculating: enrichMutation.isPending,
  } as const
}

export type ArticleReaderState = ReturnType<typeof useArticleReader>
