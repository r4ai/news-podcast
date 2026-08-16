import { useQueryClient } from "@tanstack/react-query"
import { useState, useTransition } from "react"
import { toast } from "@/shared/ui/toast"

import {
  ENRICH_QUEUE_QUERY_KEY,
  useEnrichQueueStatus,
} from "@/features/enrich/queue"
import { api } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"

/**
 * 設定の「AI処理」パネル。日次上限の使用量と、全記事の明示再処理を提供する。
 * 再処理は処理済み記事をpriority付きでキューへ戻し、日次上限に従ってワーカーが消化する。
 */
export function useAiEnrichPanel() {
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const statusQuery = useEnrichQueueStatus({ refetchInterval: 30_000 })
  const reprocessMutation = api.useMutation("post", "/v1/me/enrich/reprocess")
  const resetDailyMutation = api.useMutation(
    "post",
    "/v1/me/enrich/reset-daily"
  )

  function requestReprocess() {
    setConfirmOpen(true)
  }

  function cancelReprocess() {
    setConfirmOpen(false)
  }

  function confirmReprocess() {
    setConfirmOpen(false)
    startTransition(async () => {
      try {
        const result = await reprocessMutation.mutateAsync({})
        await queryClient.invalidateQueries({
          queryKey: ENRICH_QUEUE_QUERY_KEY,
        })
        await queryClient.invalidateQueries({
          queryKey: ["get", "/v1/me/articles/facets"],
        })
        recordBrowserEvent("enrich.reprocess_requested", {
          result: "succeeded",
          count: result.enqueued,
        })
        toast.success(`${result.enqueued}件を再処理キューに追加しました`)
      } catch {
        recordBrowserEvent("enrich.reprocess_requested", {
          result: "failed",
        })
        toast.error("再処理を開始できませんでした")
      }
    })
  }

  function resetDaily() {
    startTransition(async () => {
      try {
        await resetDailyMutation.mutateAsync({})
        await queryClient.invalidateQueries({
          queryKey: ENRICH_QUEUE_QUERY_KEY,
        })
        toast.success("本日の処理上限をリセットしました")
      } catch {
        toast.error("上限のリセットに失敗しました")
      }
    })
  }

  return {
    status: statusQuery.data,
    pending: reprocessMutation.isPending,
    confirmOpen,
    requestReprocess,
    cancelReprocess,
    confirmReprocess,
    resetDaily,
  } as const
}

export type AiEnrichPanelState = ReturnType<typeof useAiEnrichPanel>
