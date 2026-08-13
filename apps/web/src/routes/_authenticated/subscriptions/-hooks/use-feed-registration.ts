import { useQueryClient } from "@tanstack/react-query"
import { useState, useTransition } from "react"
import { toast } from "@workspace/ui/components/sonner"

import {
  feedsQueryOptions,
  feedSyncJobsQueryOptions,
  subscriptionsQueryOptions,
} from "@/features/subscriptions"
import { api } from "@/shared/api"

export function useFeedRegistration() {
  const queryClient = useQueryClient()
  const register = api.useMutation("post", "/v1/feeds")
  const [feedUrl, setFeedUrl] = useState("")
  const [pending, startTransition] = useTransition()

  function submit() {
    const url = feedUrl.trim()
    if (!url) return
    startTransition(async () => {
      try {
        await register.mutateAsync({ body: { feedUrl: url } })
        setFeedUrl("")
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: subscriptionsQueryOptions.queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: feedsQueryOptions.queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: feedSyncJobsQueryOptions.queryKey,
          }),
        ])
        toast.success("RSSフィードを登録しました")
      } catch {
        toast.error("RSSフィードを確認できませんでした")
      }
    })
  }

  return {
    feedUrl,
    setFeedUrl,
    pending,
    canSubmit: feedUrl.trim().length > 0 && !pending,
    submit,
  } as const
}
