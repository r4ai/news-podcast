import { useQueryClient } from "@tanstack/react-query"
import { useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

import { api } from "@/shared/api"

const DICTIONARY_KEY = ["get", "/v1/me/reading-dictionary"] as const

export function useReadingDictionary() {
  const queryClient = useQueryClient()
  const listQuery = api.useQuery("get", "/v1/me/reading-dictionary")
  const createMutation = api.useMutation(
    "post",
    "/v1/me/reading-dictionary",
  )
  const updateMutation = api.useMutation(
    "put",
    "/v1/me/reading-dictionary/{id}",
  )
  const deleteMutation = api.useMutation(
    "delete",
    "/v1/me/reading-dictionary/{id}",
  )

  const [surface, setSurface] = useState("")
  const [reading, setReading] = useState("")
  const [pending, startTransition] = useTransition()

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: DICTIONARY_KEY })
  }

  function addEntry() {
    const trimmedSurface = surface.trim()
    const trimmedReading = reading.trim()
    if (!trimmedSurface || !trimmedReading) return
    startTransition(async () => {
      try {
        await createMutation.mutateAsync({
          body: {
            surface: trimmedSurface,
            reading: trimmedReading,
            accentType: 0,
          },
        })
        setSurface("")
        setReading("")
        await invalidate()
        toast.success(`「${trimmedSurface}」を登録しました`)
      } catch {
        toast.error("辞書に追加できませんでした")
      }
    })
  }

  function updateEntry(
    id: string,
    patch: { surface?: string; reading?: string; accentType?: number },
  ) {
    startTransition(async () => {
      try {
        await updateMutation.mutateAsync({
          params: { path: { id } },
          body: patch,
        })
        await invalidate()
        toast.success("辞書を更新しました")
      } catch {
        toast.error("辞書を更新できませんでした")
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
    entries: listQuery.data?.items ?? [],
    isLoading: listQuery.isPending,
    surface,
    setSurface,
    reading,
    setReading,
    pending,
    addEntry,
    updateEntry,
    deleteEntry,
  } as const
}

export type ReadingDictionaryState = ReturnType<typeof useReadingDictionary>
