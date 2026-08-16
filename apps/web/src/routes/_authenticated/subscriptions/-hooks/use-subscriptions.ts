import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useOptimistic, useState, useTransition } from "react"
import { toast } from "@/shared/ui/toast"

import {
  feedSyncJobsQueryOptions,
  subscriptionsQueryOptions,
  type Subscription,
} from "@/features/subscriptions"
import { api } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"

/** 楽観的に適用する意図。純粋なreducerなので環境非依存にテストできる。 */
export type SubscriptionDraft =
  | { readonly kind: "toggle"; readonly id: string; readonly enabled: boolean }
  | { readonly kind: "remove"; readonly id: string }

export function applyDraft(
  items: readonly Subscription[],
  draft: SubscriptionDraft
): readonly Subscription[] {
  switch (draft.kind) {
    case "toggle":
      return items.map((item) =>
        item.id === draft.id ? { ...item, enabled: draft.enabled } : item
      )
    case "remove":
      return items.filter((item) => item.id !== draft.id)
  }
}

export function useSubscriptions() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(subscriptionsQueryOptions)
  const patch = api.useMutation(
    "patch",
    "/v1/me/feed-subscriptions/{subscriptionId}"
  )
  const remove = api.useMutation(
    "delete",
    "/v1/me/feed-subscriptions/{subscriptionId}"
  )
  const sync = api.useMutation(
    "post",
    "/v1/me/feed-subscriptions/{subscriptionId}/sync"
  )
  const [pending, startTransition] = useTransition()
  const [syncingId, setSyncingId] = useState<string | undefined>()
  const [items, addDraft] = useOptimistic(
    data.items as readonly Subscription[],
    applyDraft
  )

  function run(
    draft: SubscriptionDraft,
    request: () => Promise<unknown>,
    successMessage: string
  ) {
    startTransition(async () => {
      // 失敗時のrollbackはTransition終了時にReactが行う。
      addDraft(draft)
      try {
        await request()
        // 確定値はserver responseなので、再取得を待ってTransitionを閉じる。
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: subscriptionsQueryOptions.queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: feedSyncJobsQueryOptions.queryKey,
          }),
        ])
        recordBrowserEvent("subscription.changed", { result: "succeeded" })
        toast.success(successMessage)
      } catch {
        recordBrowserEvent("subscription.changed", { result: "failed" })
        toast.error("購読設定を更新できませんでした")
      }
    })
  }

  return {
    items,
    pending: pending || syncingId !== undefined,
    toggle: (item: Subscription) =>
      run(
        { kind: "toggle", id: item.id, enabled: !item.enabled },
        () =>
          patch.mutateAsync({
            params: { path: { subscriptionId: item.id } },
            body: { enabled: !item.enabled },
          }),
        item.enabled ? "購読を一時停止しました" : "購読を有効にしました"
      ),
    removeItem: (item: Subscription) =>
      run(
        { kind: "remove", id: item.id },
        () =>
          remove.mutateAsync({
            params: { path: { subscriptionId: item.id } },
          }),
        "購読を削除しました"
      ),
    syncItem: (item: Subscription) => {
      if (!item.enabled || pending || syncingId !== undefined) return
      startTransition(async () => {
        setSyncingId(item.id)
        try {
          await sync.mutateAsync({
            params: { path: { subscriptionId: item.id } },
          })
          await queryClient.invalidateQueries({
            queryKey: feedSyncJobsQueryOptions.queryKey,
          })
          recordBrowserEvent("subscription.changed", { result: "succeeded" })
          toast.success("同期を開始しました")
        } catch {
          recordBrowserEvent("subscription.changed", { result: "failed" })
          toast.error("同期を開始できませんでした")
        } finally {
          setSyncingId(undefined)
        }
      })
    },
  } as const
}
