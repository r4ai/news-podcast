import { useQueryClient } from "@tanstack/react-query"
import { useDeferredValue, useOptimistic, useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

import { api } from "@/shared/api"
import { filterArticles, type Article } from "../-model"

type ArticlePatch = { readonly read?: boolean; readonly saved?: boolean }
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

const articlesQueryOptions = api.queryOptions("get", "/v1/me/articles")

export function useArticleList() {
  const queryClient = useQueryClient()
  const { data } = api.useSuspenseQuery("get", "/v1/me/articles")
  const patch = api.useMutation("patch", "/v1/me/articles/{articleId}")
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const [, startTransition] = useTransition()
  const [items, addDraft] = useOptimistic(
    data.items as readonly Article[],
    applyDraft
  )

  function update(article: Article, next: ArticlePatch) {
    startTransition(async () => {
      addDraft({ id: article.id, patch: next })
      try {
        await patch.mutateAsync({
          params: { path: { articleId: article.id } },
          body: next,
        })
        // 確定値はserver responseなので、invalidateを待ってTransitionを閉じる。
        await queryClient.invalidateQueries({
          queryKey: articlesQueryOptions.queryKey,
        })
      } catch {
        toast.error("記事の状態を更新できませんでした")
      }
    })
  }

  return {
    articles: filterArticles(items, deferredSearch),
    search,
    setSearch,
    toggleSaved: (article: Article) =>
      update(article, { saved: !article.saved }),
    markRead: (article: Article) => update(article, { read: true }),
  } as const
}
