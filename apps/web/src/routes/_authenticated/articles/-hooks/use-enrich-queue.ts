import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import {
  ENRICH_QUEUE_QUERY_KEY,
  type EnrichQueueStatus,
} from "@/features/enrich/queue"
import { api } from "@/shared/api"
import { subscribeEventStream } from "@/shared/api"

/**
 * AI補助キュー状態ダイアログ。開いている間だけSSEでライブ更新し、
 * 接続できなければGETポーリングへフォールバックする。
 */
export function useEnrichQueueDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [streamConnected, setStreamConnected] = useState(false)

  const statusQuery = api.useQuery(
    "get",
    "/v1/me/enrich/queue",
    undefined,
    {
      enabled: open,
      refetchInterval: (query) =>
        open && query.state.data && !streamConnected ? 1_000 : false,
    }
  )

  useEffect(() => {
    if (!open) {
      setStreamConnected(false)
      return
    }
    const controller = new AbortController()
    void subscribeEventStream("/v1/me/enrich/queue/events", {
      signal: controller.signal,
      onOpen: () => setStreamConnected(true),
      onFrame: (frame) => {
        if (frame.event !== "snapshot") return
        try {
          const payload = JSON.parse(frame.data) as {
            type: "snapshot"
            data: EnrichQueueStatus
          }
          if (payload.type === "snapshot") {
            queryClient.setQueryData(ENRICH_QUEUE_QUERY_KEY, payload.data)
          }
        } catch {
          // 壊れたフレームは無視し、次のスナップショットを待つ。
        }
      },
      onGiveUp: () => setStreamConnected(false),
    }).finally(() => {
      if (!controller.signal.aborted) setStreamConnected(false)
    })
    return () => controller.abort()
  }, [open, queryClient])

  return {
    open,
    onOpenChange: setOpen,
    status: statusQuery.data as EnrichQueueStatus | undefined,
    connected: streamConnected,
  } as const
}

export type EnrichQueueDialogState = ReturnType<typeof useEnrichQueueDialog>
