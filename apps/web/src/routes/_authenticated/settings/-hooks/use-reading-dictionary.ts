import { useQueryClient } from "@tanstack/react-query"
import { useStore } from "jotai"
import { useTransition } from "react"
import { toast } from "@/shared/ui/toast"

import { api } from "@/shared/api"
import { readingReadingDraftAtom, readingSurfaceDraftAtom } from "../-atoms"
import { normalizeReading, problemStatus, readingProblem } from "../-model"

const DICTIONARY_KEY = ["get", "/v1/me/reading-dictionary"] as const

// 未取得のときに`?? []`と書くと、描画のたびに別物の空配列が下流へ渡る。
// 参照が変わる限りCompilerのメモ化も効かないので、空は1つを共有する。
const NO_ENTRIES = [] as const

export function useReadingDictionary() {
  const queryClient = useQueryClient()
  // 下書きは購読せずに読む。購読すると打鍵のたびにこのhookの利用者
  // (= 登録済み一覧を含むパネル全体) が描き直される。
  const store = useStore()
  const listQuery = api.useQuery("get", "/v1/me/reading-dictionary")
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

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: DICTIONARY_KEY })
  }

  function addEntry() {
    const trimmedSurface = store.get(readingSurfaceDraftAtom).trim()
    // 送るのは正規化した後の読み。ひらがなのままだとRPC境界で落ちる。
    const reading = normalizeReading(store.get(readingReadingDraftAtom))
    if (!trimmedSurface || readingProblem(reading) !== undefined) return
    startTransition(async () => {
      try {
        await createMutation.mutateAsync({
          body: {
            surface: trimmedSurface,
            reading,
            accentType: 0,
          },
        })
        store.set(readingSurfaceDraftAtom, "")
        store.set(readingReadingDraftAtom, "")
        await invalidate()
        toast.success(`「${trimmedSurface}」を登録しました`)
      } catch (error) {
        // 409は名寄せの衝突。「追加できません」だけでは、何をどうすれば
        // いいのか分からない。
        toast.error(
          problemStatus(error) === 409
            ? `「${trimmedSurface}」は既に登録されています`
            : "辞書に追加できませんでした"
        )
      }
    })
  }

  function updateEntry(
    id: string,
    patch: { surface?: string; reading?: string; accentType?: number }
  ) {
    const body =
      patch.surface !== undefined
        ? { surface: patch.surface }
        : patch.reading !== undefined
          ? { reading: normalizeReading(patch.reading) }
          : patch.accentType !== undefined
            ? { accentType: patch.accentType }
            : undefined
    if (body === undefined) return
    startTransition(async () => {
      try {
        await updateMutation.mutateAsync({
          params: { path: { id } },
          body,
        })
        await invalidate()
        toast.success("辞書を更新しました")
      } catch (error) {
        toast.error(
          problemStatus(error) === 409
            ? "同じ表記が既に登録されています"
            : "辞書を更新できませんでした"
        )
      }
    })
  }

  function deleteEntry(id: string) {
    startTransition(async () => {
      try {
        await deleteMutation.mutateAsync({
          params: { path: { id } },
        })
        await invalidate()
      } catch {
        toast.error("辞書から削除できませんでした")
      }
    })
  }

  return {
    entries: listQuery.data?.items ?? NO_ENTRIES,
    isLoading: listQuery.isPending,
    pending,
    addEntry,
    updateEntry,
    deleteEntry,
  } as const
}

export type ReadingDictionaryState = ReturnType<typeof useReadingDictionary>
