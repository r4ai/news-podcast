import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react"
import { toast } from "@workspace/ui/components/sonner"

import { api } from "@/shared/api"
import { createActionQueue } from "@/shared/lib/action-queue"
import {
  articleMarkdownQueryOptions,
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

function applyPatch(
  article: Article | undefined,
  patch: ArticlePatch
): Article | undefined {
  return article ? { ...article, ...patch } : article
}

export type UseArticleReaderParams = {
  readonly articleId: string | undefined
  /** 一覧の`includeHidden`。非表示にした記事を一覧から外すかの判断に使う。 */
  readonly includeHidden?: boolean
}

/**
 * 選択中の記事の詳細取得・本文/アーカイブ取得・状態更新をまとめるhook。
 * viewはpropsだけを受け取る (ADR-0018)。
 */
export function useArticleReader({
  articleId,
  includeHidden = false,
}: UseArticleReaderParams) {
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()
  const enqueueRef = useRef(createActionQueue())

  const articleQuery = useQuery({
    ...articleQueryOptions(articleId ?? ""),
    enabled: articleId !== undefined,
  })

  const markdownQuery = useQuery({
    ...articleMarkdownQueryOptions(articleId ?? ""),
    enabled: articleId !== undefined,
  })

  const [userSource, setUserSource] = useState<ArticleSource | undefined>(
    undefined
  )
  useEffect(() => setUserSource(undefined), [articleId])

  const markdownReady = !markdownQuery.isLoading
  const autoFallback =
    markdownReady &&
    shouldFallbackToArchive({
      markdown: markdownQuery.data,
      isError: markdownQuery.isError,
    })
  const source: ArticleSource =
    userSource ?? (autoFallback ? "archive" : "markdown")
  const didAutoFallback = userSource === undefined && autoFallback

  const [article, addDraft] = useOptimistic(articleQuery.data, applyPatch)

  const patchMutation = api.useMutation("patch", "/v1/me/articles/{articleId}")
  const enrichMutation = api.useMutation(
    "post",
    "/v1/me/articles/{articleId}/enrich"
  )

  const settle = useCallback(
    (before: Article, updated: Article) =>
      writeArticleToCaches(queryClient, {
        article: updated,
        before,
        includeHidden,
      }),
    [queryClient, includeHidden]
  )

  const update = useCallback(
    (patch: ArticlePatch, errorMessage: string) => {
      const target = article
      if (!target) return
      startTransition(async () => {
        addDraft(patch)
        try {
          const updated = await enqueueRef.current(() =>
            patchMutation.mutateAsync({
              params: { path: { articleId: target.id } },
              body: patch,
            })
          )
          settle(target, updated as Article)
        } catch {
          toast.error(errorMessage)
        }
      })
    },
    [article, addDraft, patchMutation, settle]
  )

  const pendingReadRef = useRef<ReadonlyMap<string, Article>>(new Map())
  // ユーザーが明示的に「未読へ戻した」記事は、離脱時の自動既読化から除外する。
  const userUnreadRef = useRef<ReadonlySet<string>>(new Set())

  // flushはref経由で最新を参照する。依存にpatchMutationを入れると毎renderで
  // callbackが作り直され、flush effectが不要な再実行を起こすため。
  const flushPendingReadsRef = useRef<() => void>(() => {})
  flushPendingReadsRef.current = useCallback(() => {
    const pending = pendingReadRef.current
    if (pending.size === 0) return
    pendingReadRef.current = new Map()
    void Promise.allSettled(
      [...pending.values()].map((target) =>
        enqueueRef
          .current(() =>
            patchMutation.mutateAsync({
              params: { path: { articleId: target.id } },
              body: { read: true },
            })
          )
          .then((updated) => settle(target, updated as Article))
          .catch(() => toast.error("既読にできませんでした"))
      )
    )
  }, [patchMutation, settle])

  // 記事を離れる瞬間 (切り替え・一覧へ戻る・unmount) に、開いていた未読記事を既読へフラッシュする。
  useEffect(() => {
    return () => flushPendingReadsRef.current()
  }, [articleId])

  // 開いた未読記事をpendingへ記録する。読み込みが終わるまでフラッシュしない。
  useEffect(() => {
    if (!article || article.read) return
    if (userUnreadRef.current.has(article.id)) return
    pendingReadRef.current = new Map(pendingReadRef.current).set(
      article.id,
      article
    )
  }, [article])

  // タブを閉じる・別ページへ移動する場合も、既読へフラッシュする。
  useEffect(() => {
    function onPageHide() {
      flushPendingReadsRef.current()
    }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [])

  const markUnread = () => {
    if (!article) return
    userUnreadRef.current = new Set(userUnreadRef.current).add(article.id)
    const next = new Map(pendingReadRef.current)
    next.delete(article.id)
    pendingReadRef.current = next
    update({ read: false }, "未読に戻せませんでした")
  }

  const recalculateAi = useCallback(async () => {
    const target = article
    if (!target) return
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
  }, [article, enrichMutation, queryClient])

  return {
    articleId,
    article,
    isLoading: articleQuery.isLoading,
    isError: articleQuery.isError,
    refetch: () => void articleQuery.refetch(),
    source,
    setSource: setUserSource,
    didAutoFallback,
    markdown: markdownQuery.data,
    isMarkdownLoading: markdownQuery.isLoading,
    // The functional Gateway exposes manual archival as POST, but deliberately
    // does not expose stored raw HTML. Keep the external-source fallback honest.
    archiveHtml: undefined as string | undefined,
    isArchiveLoading: false,
    archiveUnavailable: source === "archive",
    toggleSaved: () =>
      article &&
      update({ saved: !article.saved }, "保存状態を更新できませんでした"),
    toggleReadLater: () =>
      article &&
      update(
        { readLater: !article.readLater },
        "あとで読むを更新できませんでした"
      ),
    toggleHidden: () =>
      article &&
      update({ hidden: !article.hidden }, "非表示を更新できませんでした"),
    markUnread,
    recalculateAi,
    isRecalculating: enrichMutation.isPending,
  } as const
}

export type ArticleReaderState = ReturnType<typeof useArticleReader>
