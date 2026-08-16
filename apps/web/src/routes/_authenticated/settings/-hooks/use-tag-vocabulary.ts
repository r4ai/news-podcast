import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "jotai"
import { useOptimistic, useTransition } from "react"
import { toast } from "@/shared/ui/toast"

import type { Tag, TagSuggestion } from "@/features/settings"
import { api } from "@/shared/api"
import { tagNameDraftAtom } from "../-atoms"
import {
  applyTagVocabularyDraft,
  type TagVocabularyDraft,
  type TagVocabulary,
} from "../-model"
import { tagSuggestionsQueryOptions, tagsQueryOptions } from "../-queries"

// 未取得のときに`?? []`と書くと、描画のたびに別物の空配列が下流へ渡る。
const NO_TAGS: readonly Tag[] = []
const NO_SUGGESTIONS: readonly TagSuggestion[] = []

/**
 * 応答が返るまでの間だけ使うタグ。idは手元で振り、確定値はサーバ応答で
 * 置き換わる。`key`が安定するので、確定した瞬間に行が作り直されない。
 */
function provisionalTag(name: string): Tag {
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  } as Tag
}

/**
 * タグ語彙(tags)とAI提案(tag_suggestions)の管理。
 * 語彙はAIの構造化出力のenum候補にそのまま使われるため、ここでの追加/削除が
 * 次回のAI補助バッチの候補集合に直接反映される(enrich-worker.ts参照)。
 *
 * 追加・削除・採用はいずれも楽観的に見せる。待たせると更新と取り直しで往復
 * 2回分、消したはずのタグが残る。確定値はサーバ応答のままで、巻き戻しは
 * Transitionの終了時にReactが行う (ADR-0047)。
 */
export function useTagVocabulary() {
  const queryClient = useQueryClient()
  const tagsQuery = useQuery(tagsQueryOptions)
  const suggestionsQuery = useQuery(tagSuggestionsQueryOptions)
  const createMutation = api.useMutation("post", "/v1/me/tags")
  const deleteMutation = api.useMutation("delete", "/v1/me/tags/{tagId}")
  const promoteMutation = api.useMutation(
    "post",
    "/v1/me/tag-suggestions/promote"
  )
  // 下書きは購読せずに読む。購読すると打鍵のたびに一覧まで描き直される。
  const store = useStore()
  const [pending, startTransition] = useTransition()

  const [vocabulary, addDraft] = useOptimistic<
    TagVocabulary<Tag, TagSuggestion>,
    TagVocabularyDraft<Tag>
  >(
    {
      tags: (tagsQuery.data?.items ?? NO_TAGS) as readonly Tag[],
      suggestions: (suggestionsQuery.data?.items ??
        NO_SUGGESTIONS) as readonly TagSuggestion[],
    },
    applyTagVocabularyDraft
  )

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tagsQueryOptions.queryKey }),
      queryClient.invalidateQueries({
        queryKey: tagSuggestionsQueryOptions.queryKey,
      }),
    ])
  }

  /**
   * 意図を先に当て、確定を待ってからTransitionを閉じる。
   * 取り直しまで開けておくのは、閉じた瞬間に楽観値が消えてサーバ応答が
   * 届くまでの1描画分だけ古い一覧へ戻るのを防ぐため。
   */
  function run(
    draft: TagVocabularyDraft<Tag>,
    request: () => Promise<unknown>,
    onSuccess: (result: unknown) => void,
    errorMessage: string
  ) {
    startTransition(async () => {
      addDraft(draft)
      try {
        const result = await request()
        await invalidate()
        onSuccess(result)
      } catch {
        toast.error(errorMessage)
      }
    })
  }

  function createTag() {
    const trimmed = store.get(tagNameDraftAtom).trim()
    if (!trimmed) return
    // 同名の作成はサーバ側で冪等 (`onConflictDoNothing` して既存を読み直す)。
    // エラーにならないので、既にあったことは応答のidが手元の語彙と一致するかで
    // 見分ける。「追加しました」と出しておいて件数が増えないのが一番戸惑う。
    const known = new Set(vocabulary.tags.map((tag) => tag.id))
    store.set(tagNameDraftAtom, "")
    run(
      { kind: "add", tag: provisionalTag(trimmed) },
      () => createMutation.mutateAsync({ body: { name: trimmed } }),
      (created) => {
        toast.success(
          known.has((created as Tag).id)
            ? `タグ「${trimmed}」は既に登録されています`
            : `タグ「${trimmed}」を追加しました`
        )
      },
      "タグを追加できませんでした"
    )
  }

  function deleteTag(tagId: string) {
    run(
      { kind: "remove", id: tagId },
      () => deleteMutation.mutateAsync({ params: { path: { tagId } } }),
      () => {},
      "タグを削除できませんでした"
    )
  }

  function promoteSuggestion(suggestionName: string) {
    run(
      { kind: "promote", tag: provisionalTag(suggestionName) },
      () => promoteMutation.mutateAsync({ body: { name: suggestionName } }),
      () => toast.success(`「${suggestionName}」をタグにしました`),
      "タグを作成できませんでした"
    )
  }

  return {
    tags: vocabulary.tags,
    suggestions: vocabulary.suggestions,
    isLoading: tagsQuery.isPending,
    pending,
    createTag,
    deleteTag,
    promoteSuggestion,
  } as const
}

export type TagVocabularyState = ReturnType<typeof useTagVocabulary>
