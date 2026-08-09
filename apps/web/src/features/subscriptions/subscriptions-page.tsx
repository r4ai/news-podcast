import type { components } from "@news-podcast/contracts/openapi"
import { useOptimistic, useTransition } from "react"

import { api } from "@/api/client"
import { queryClient } from "@/app/query-client"

type Subscription = components["schemas"]["FeedSubscription"]
type OptimisticAction =
  | { readonly type: "toggle"; readonly id: string; readonly enabled: boolean }
  | { readonly type: "delete"; readonly id: string }

export function SubscriptionsPage() {
  const subscriptions = api.useSuspenseQuery("get", "/v1/me/feed-subscriptions")
  const feeds = api.useSuspenseQuery("get", "/v1/feeds", {
    params: { query: {} },
  })
  const patch = api.useMutation(
    "patch",
    "/v1/me/feed-subscriptions/{subscriptionId}"
  )
  const remove = api.useMutation(
    "delete",
    "/v1/me/feed-subscriptions/{subscriptionId}"
  )
  const add = api.useMutation("post", "/v1/me/feed-subscriptions")
  const [pending, startTransition] = useTransition()
  const [visible, updateOptimistic] = useOptimistic(
    subscriptions.data.items,
    (state: readonly Subscription[], action: OptimisticAction) =>
      action.type === "delete"
        ? state.filter((item) => item.id !== action.id)
        : state.map((item) =>
            item.id === action.id ? { ...item, enabled: action.enabled } : item
          )
  )
  const feedById = new Map(feeds.data.items.map((feed) => [feed.id, feed]))
  const subscribedIds = new Set(visible.map((item) => item.feedId))

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: api.queryOptions("get", "/v1/me/feed-subscriptions").queryKey,
    })

  function toggle(item: Subscription) {
    startTransition(async () => {
      updateOptimistic({ type: "toggle", id: item.id, enabled: !item.enabled })
      await patch.mutateAsync({
        params: { path: { subscriptionId: item.id } },
        body: { enabled: !item.enabled },
      })
      await refresh()
    })
  }

  function deleteItem(item: Subscription) {
    startTransition(async () => {
      updateOptimistic({ type: "delete", id: item.id })
      await remove.mutateAsync({
        params: { path: { subscriptionId: item.id } },
      })
      await refresh()
    })
  }

  function addFeed(feedId: string) {
    startTransition(async () => {
      await add.mutateAsync({ body: { feedId } })
      await refresh()
    })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">購読フィード</h1>
        <p className="mt-2 text-muted-foreground">
          生成時点の有効な購読だけをスナップショットします。
        </p>
      </header>
      <section className="space-y-3">
        {visible.map((item) => (
          <article
            className="flex items-center justify-between gap-4 rounded-2xl border bg-card p-4"
            key={item.id}
          >
            <div>
              <h2 className="font-medium">
                {feedById.get(item.feedId)?.name ?? item.feedId}
              </h2>
              <p className="text-sm text-muted-foreground">
                {item.enabled ? "生成対象" : "一時停止"}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-lg border px-3 py-2 text-sm"
                disabled={pending}
                onClick={() => toggle(item)}
                type="button"
              >
                {item.enabled ? "無効化" : "有効化"}
              </button>
              <button
                className="rounded-lg border px-3 py-2 text-sm text-destructive"
                disabled={pending}
                onClick={() => deleteItem(item)}
                type="button"
              >
                削除
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">カタログから追加</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {feeds.data.items
            .filter((feed) => !subscribedIds.has(feed.id))
            .map((feed) => (
              <button
                className="rounded-lg border px-3 py-2 text-sm"
                disabled={pending}
                key={feed.id}
                onClick={() => addFeed(feed.id)}
                type="button"
              >
                + {feed.name}
              </button>
            ))}
        </div>
      </section>
    </div>
  )
}
