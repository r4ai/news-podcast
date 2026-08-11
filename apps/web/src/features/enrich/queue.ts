import { api } from "@/shared/api"

export type EnrichQueueItemStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"

export type EnrichQueueItem = {
  readonly feedItemId: string
  readonly title: string
  readonly sourceName: string
  readonly priority: number
  readonly reason: "new" | "reprocess"
  readonly status: EnrichQueueItemStatus
  readonly attempt: number
  readonly error?: string
  readonly publishedAt?: string
  readonly createdAt: string
  readonly startedAt?: string
  readonly completedAt?: string
}

export type EnrichQueueStatus = {
  readonly processing: readonly EnrichQueueItem[]
  readonly pending: {
    readonly count: number
    readonly items: readonly EnrichQueueItem[]
  }
  readonly failed: {
    readonly count: number
    readonly items: readonly EnrichQueueItem[]
  }
  readonly recent: readonly EnrichQueueItem[]
  readonly daily: { readonly used: number; readonly limit: number }
  readonly reprocessable: { readonly count: number }
}

export const ENRICH_QUEUE_QUERY_KEY = ["get", "/v1/me/enrich/queue"] as const

export function useEnrichQueueStatus(options?: {
  readonly enabled?: boolean
  readonly refetchInterval?: number | false
}) {
  return api.useQuery("get", "/v1/me/enrich/queue", undefined, {
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
  })
}
