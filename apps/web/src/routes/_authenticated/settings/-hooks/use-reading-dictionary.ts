import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "jotai"
import { useOptimistic, useTransition } from "react"
import { toast } from "@/shared/ui/toast"

import { api } from "@/shared/api"
import { readingReadingDraftAtom, readingSurfaceDraftAtom } from "../-atoms"
import {
  applyReadingDictionaryDraft,
  normalizeReading,
  problemStatus,
  readingProblem,
  type ReadingDictionaryDraft,
  type ReadingDictionaryPatch,
} from "../-model"
import { readingDictionaryQueryOptions } from "../-queries"

type Entry = {
  readonly id: string
  readonly surface: string
  readonly reading: string
  readonly accentType: number
  readonly source: "manual" | "ai_auto"
  readonly createdAt: string
}

// 未取得のときに`?? []`と書くと、描画のたびに別物の空配列が下流へ渡る。
// 参照が変わる限りCompilerのメモ化も効かないので、空は1つを共有する。
const NO_ENTRIES: readonly Entry[] = []

/**
 * 読み辞書。追加・編集・削除はいずれも楽観的に見せる。確定値はサーバ応答で、
 * 失敗時の巻き戻しはTransitionの終了時にReactが行う (ADR-0047)。
 */
export function useReadingDictionary() {
  const queryClient = useQueryClient()
  // 下書きは購読せずに読む。購読すると打鍵のたびにこのhookの利用者
  // (= 登録済み一覧を含むパネル全体) が描き直される。
  const store = useStore()
  const listQuery = useQuery(readingDictionaryQueryOptions)
  const createMutation = api.useMutation("post", "/v1/me/reading-dictionary")
  const updateMutation = api.useMutation(
    "put",
    "/v1/me/reading-dictionary/{id}"
  )
  const deleteMutation = api.useMutation(
    "delete",
    "/v1/me/reading-dictionary/{id}"
  )

  const [pending, startTransition] = useTransition()
  const [entries, addDraft] = useOptimistic<
    readonly Entry[],
    ReadingDictionaryDraft<Entry>
  >(
    (listQuery.data?.items ?? NO_ENTRIES) as readonly Entry[],
    applyReadingDictionaryDraft
  )

  async function invalidate() {
    await queryClient.invalidateQueries({
      queryKey: readingDictionaryQueryOptions.queryKey,
    })
  }

  function run(
    draft: ReadingDictionaryDraft<Entry>,
    request: () => Promise<unknown>,
    onSuccess: () => void,
    onError: (error: unknown) => void
  ) {
    startTransition(async () => {
      addDraft(draft)
      try {
        await request()
        // 確定値はサーバ応答。取り直しまでTransitionを開けておくことで、
        // 楽観値から確定値へ1描画で移る。
        await invalidate()
        onSuccess()
      } catch (error) {
        onError(error)
      }
    })
  }

  function addEntry() {
    const trimmedSurface = store.get(readingSurfaceDraftAtom).trim()
    // 送るのは正規化した後の読み。ひらがなのままだとRPC境界で落ちる。
    const reading = normalizeReading(store.get(readingReadingDraftAtom))
    if (!trimmedSurface || readingProblem(reading) !== undefined) return
    store.set(readingSurfaceDraftAtom, "")
    store.set(readingReadingDraftAtom, "")
    run(
      {
        kind: "add",
        entry: {
          // 送信前に手元で振る識別子。応答が返るまでの間だけ使う。
          id: crypto.randomUUID(),
          surface: trimmedSurface,
          reading,
          accentType: 0,
          source: "manual",
          createdAt: new Date().toISOString(),
        },
      },
      () =>
        createMutation.mutateAsync({
          body: { surface: trimmedSurface, reading, accentType: 0 },
        }),
      () => toast.success(`「${trimmedSurface}」を登録しました`),
      // 409は名寄せの衝突。「追加できません」だけでは、何をどうすれば
      // いいのか分からない。
      (error) =>
        toast.error(
          problemStatus(error) === 409
            ? `「${trimmedSurface}」は既に登録されています`
            : "辞書に追加できませんでした"
        )
    )
  }

  function updateEntry(id: string, patch: ReadingDictionaryPatch) {
    const body =
      patch.surface !== undefined
        ? { surface: patch.surface }
        : patch.reading !== undefined
          ? { reading: normalizeReading(patch.reading) }
          : patch.accentType !== undefined
            ? { accentType: patch.accentType }
            : undefined
    if (body === undefined) return
    run(
      { kind: "update", id, patch: body },
      () => updateMutation.mutateAsync({ params: { path: { id } }, body }),
      () => toast.success("辞書を更新しました"),
      (error) =>
        toast.error(
          problemStatus(error) === 409
            ? "同じ表記が既に登録されています"
            : "辞書を更新できませんでした"
        )
    )
  }

  function deleteEntry(id: string) {
    run(
      { kind: "remove", id },
      () => deleteMutation.mutateAsync({ params: { path: { id } } }),
      () => {},
      () => toast.error("辞書から削除できませんでした")
    )
  }

  return {
    entries,
    isLoading: listQuery.isPending,
    pending,
    addEntry,
    updateEntry,
    deleteEntry,
  } as const
}

export type ReadingDictionaryState = ReturnType<typeof useReadingDictionary>
