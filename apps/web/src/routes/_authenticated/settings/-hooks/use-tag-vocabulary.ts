import { useQueryClient } from "@tanstack/react-query"
import { useStore } from "jotai"
import { useTransition } from "react"
import { toast } from "@/shared/ui/toast"

import { api } from "@/shared/api"
import { tagNameDraftAtom } from "../-atoms"

const TAGS_KEY = ["get", "/v1/me/tags"] as const
const SUGGESTIONS_KEY = ["get", "/v1/me/tag-suggestions"] as const

/**
 * タグ語彙(tags)とAI提案(tag_suggestions)の管理。
 * 語彙はAIの構造化出力のenum候補にそのまま使われるため、ここでの追加/削除が
 * 次回のAI補助バッチの候補集合に直接反映される(enrich-worker.ts参照)。
 */
export function useTagVocabulary() {
  const queryClient = useQueryClient()
  const tagsQuery = api.useQuery("get", "/v1/me/tags")
  const suggestionsQuery = api.useQuery("get", "/v1/me/tag-suggestions")
  const createMutation = api.useMutation("post", "/v1/me/tags")
  const deleteMutation = api.useMutation("delete", "/v1/me/tags/{tagId}")
  const promoteMutation = api.useMutation(
    "post",
    "/v1/me/tag-suggestions/promote"
  )
  // 下書きは購読せずに読む。購読すると打鍵のたびに一覧まで描き直される。
  const store = useStore()
  const [pending, startTransition] = useTransition()

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: TAGS_KEY }),
      queryClient.invalidateQueries({ queryKey: SUGGESTIONS_KEY }),
    ])
  }

  function createTag() {
    const trimmed = store.get(tagNameDraftAtom).trim()
    if (!trimmed) return
    startTransition(async () => {
      try {
        await createMutation.mutateAsync({ body: { name: trimmed } })
        store.set(tagNameDraftAtom, "")
        await invalidate()
        toast.success(`タグ「${trimmed}」を追加しました`)
      } catch {
        toast.error("タグを追加できませんでした")
      }
    })
  }

  function deleteTag(tagId: string) {
    startTransition(async () => {
      try {
        await deleteMutation.mutateAsync({ params: { path: { tagId } } })
        await invalidate()
      } catch {
        toast.error("タグを削除できませんでした")
      }
    })
  }

  function promoteSuggestion(suggestionName: string) {
    startTransition(async () => {
      try {
        await promoteMutation.mutateAsync({
          body: { name: suggestionName },
        })
        await invalidate()
        toast.success(`「${suggestionName}」をタグにしました`)
      } catch {
        toast.error("タグを作成できませんでした")
      }
    })
  }

  return {
    tags: tagsQuery.data?.items ?? [],
    suggestions: suggestionsQuery.data?.items ?? [],
    isLoading: tagsQuery.isPending,
    pending,
    createTag,
    deleteTag,
    promoteSuggestion,
  } as const
}

export type TagVocabularyState = ReturnType<typeof useTagVocabulary>
