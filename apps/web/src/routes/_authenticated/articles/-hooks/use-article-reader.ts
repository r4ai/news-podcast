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

import { api, fetchClient } from "@/shared/api"
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
}

/**
 * 選択中の記事の詳細取得・本文/アーカイブ取得・状態更新をまとめるhook。
 * viewはpropsだけを受け取る (ADR-0018)。
 */
export function useArticleReader({ articleId }: UseArticleReaderParams) {
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()

  const articleQuery = api.useQuery(
    "get",
    "/v1/me/articles/{articleId}",
    { params: { path: { articleId: articleId ?? "" } } },
    { enabled: articleId !== undefined }
  )

  const markdownQuery = useQuery({
    queryKey: ["article-markdown", articleId],
    queryFn: async () => {
      const { data, error } = await fetchClient.GET(
        "/v1/me/articles/{articleId}/markdown",
        {
          params: { path: { articleId: articleId ?? "" } },
          parseAs: "text",
        }
      )
      if (error) throw error
      return data ?? ""
    },
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

  const archiveQuery = useQuery({
    queryKey: ["article-archive", articleId],
    queryFn: async () => {
      const { data, error } = await fetchClient.GET(
        "/v1/me/articles/{articleId}/archive",
        {
          params: { path: { articleId: articleId ?? "" } },
          parseAs: "text",
        }
      )
      if (error) throw error
      return data ?? ""
    },
    enabled: articleId !== undefined && source === "archive",
  })

  const [article, addDraft] = useOptimistic(articleQuery.data, applyPatch)

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["get", "/v1/me/articles/{articleId}"],
      }),
      queryClient.invalidateQueries({ queryKey: ["get", "/v1/me/articles"] }),
      queryClient.invalidateQueries({
        queryKey: ["get", "/v1/me/articles/facets"],
      }),
    ])
  }, [queryClient])

  const patchMutation = api.useMutation("patch", "/v1/me/articles/{articleId}")

  const update = useCallback(
    (patch: ArticlePatch, errorMessage: string) => {
      const target = article
      if (!target) return
      startTransition(async () => {
        addDraft(patch)
        try {
          await patchMutation.mutateAsync({
            params: { path: { articleId: target.id } },
            body: patch,
          })
          await invalidate()
        } catch {
          toast.error(errorMessage)
        }
      })
    },
    [article, addDraft, patchMutation, invalidate]
  )

  const pendingReadRef = useRef<ReadonlyMap<string, Article>>(new Map())

  // flushはref経由で最新を参照する。依存にpatchMutationを入れると毎renderで
  // callbackが作り直され、flush effectが不要な再実行を起こすため。
  const flushPendingReadsRef = useRef<() => void>(() => {})
  flushPendingReadsRef.current = useCallback(() => {
    const pending = pendingReadRef.current
    if (pending.size === 0) return
    pendingReadRef.current = new Map()
    void Promise.allSettled(
      [...pending.values()].map((target) =>
        patchMutation
          .mutateAsync({
            params: { path: { articleId: target.id } },
            body: { read: true },
          })
          .catch(() => toast.error("既読にできませんでした"))
      )
    ).then(() => void invalidate())
  }, [patchMutation, invalidate])

  // 記事を離れる瞬間 (切り替え・一覧へ戻る・unmount) に、開いていた未読記事を既読へフラッシュする。
  useEffect(() => {
    return () => flushPendingReadsRef.current()
  }, [articleId])

  // 開いた未読記事をpendingへ記録する。読み込みが終わるまでフラッシュしない。
  useEffect(() => {
    if (!article || article.read) return
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
    archiveHtml: archiveQuery.data,
    isArchiveLoading: archiveQuery.isLoading,
    archiveUnavailable: archiveQuery.isError,
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
    markUnread: () =>
      article && update({ read: false }, "未読に戻せませんでした"),
  } as const
}

export type ArticleReaderState = ReturnType<typeof useArticleReader>
