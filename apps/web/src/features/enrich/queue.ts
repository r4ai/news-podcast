import type { paths } from "@news-podcast/contracts/openapi"

import { api } from "@/shared/api"

/** 生成契約そのままの応答型。`select`の入力はこれで受ける。 */
type EnrichQueueResponse =
  paths["/v1/me/enrich/queue"]["get"]["responses"]["200"]["content"]["application/json"]

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

/**
 * `select`は「使う分だけ購読する」ためにある。この応答はキュー全体
 * (processing / pending / failed / recent の各明細) を含むので、ポーリング
 * ごとに他人の進捗で識別子が変わる。日次使用量しか描かない画面がそれを
 * まるごと購読すると、30秒おきに無関係な再描画が起きる。
 *
 * TanStack Queryは`select`の結果にも構造共有を掛けるため、選んだ値が
 * 前回と等しければ同じ参照が返り、再描画は起きない。
 */
export function useEnrichQueueStatus<
  TSelected = EnrichQueueResponse,
>(options?: {
  readonly enabled?: boolean
  readonly refetchInterval?: number | false
  readonly select?: (status: EnrichQueueResponse) => TSelected
}) {
  // 省略時も恒等関数を渡す。`select`が`undefined`になり得ると、返り値の型が
  // 「応答そのもの」と「選んだ値」の合併になってしまう。
  const select =
    options?.select ?? ((status: EnrichQueueResponse) => status as TSelected)
  return api.useQuery("get", "/v1/me/enrich/queue", undefined, {
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    select,
  })
}
