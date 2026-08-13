import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

import {
  feedsQueryOptions,
  subscriptionsQueryOptions,
  type Feed,
} from "@/features/subscriptions"
import { api } from "@/shared/api"
import { recordBrowserEvent } from "@/shared/observability/events"

/** 未購読のフィードだけをカタログ候補にする。 */
export function availableFeeds(
  feeds: readonly Feed[],
  subscribedFeedIds: readonly string[]
): readonly Feed[] {
  const subscribed = new Set(subscribedFeedIds)
  return feeds.filter((feed) => !subscribed.has(feed.id))
}

export function useFeedCatalog() {
  const queryClient = useQueryClient()
  const { data: feeds } = useSuspenseQuery(feedsQueryOptions)
  const { data: subscriptions } = useSuspenseQuery(subscriptionsQueryOptions)
  const add = api.useMutation("post", "/v1/me/feed-subscriptions")
  const [selectedFeedId, setSelectedFeedId] = useState("")
  const [pending, startTransition] = useTransition()

  const candidates = availableFeeds(
    feeds.items as readonly Feed[],
    subscriptions.items.map((subscription) => subscription.feedId)
  )

  function addSelected() {
    if (!selectedFeedId) return
    const selectedFeed = candidates.find((feed) => feed.id === selectedFeedId)
    if (!selectedFeed) return
    startTransition(async () => {
      try {
        await add.mutateAsync({ body: { feedUrl: selectedFeed.feedUrl } })
        await queryClient.invalidateQueries({
          queryKey: subscriptionsQueryOptions.queryKey,
        })
        setSelectedFeedId("")
        recordBrowserEvent("subscription.changed", {
          action: "add",
          result: "succeeded",
        })
        toast.success("購読を追加しました")
      } catch {
        recordBrowserEvent("subscription.changed", {
          action: "add",
          result: "failed",
        })
        toast.error("購読を追加できませんでした")
      }
    })
  }

  return {
    candidates,
    selectedFeedId,
    setSelectedFeedId,
    pending,
    canAdd: selectedFeedId.length > 0 && !pending,
    addSelected,
  } as const
}
