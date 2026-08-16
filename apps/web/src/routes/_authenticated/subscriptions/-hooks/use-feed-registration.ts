import { useQueryClient } from "@tanstack/react-query"
import { useStore } from "jotai"
import { useTransition } from "react"
import { toast } from "@/shared/ui/toast"

import {
  feedsQueryOptions,
  feedSyncJobsQueryOptions,
  subscriptionsQueryOptions,
} from "@/features/subscriptions"
import { api } from "@/shared/api"
import { feedUrlDraftAtom } from "../-atoms"

export function useFeedRegistration() {
  const queryClient = useQueryClient()
  const register = api.useMutation("post", "/v1/feeds")
  // URLの中身は購読せずに読む。打鍵で購読フィード一覧まで描き直さないため。
  const store = useStore()
  const [pending, startTransition] = useTransition()

  function submit() {
    const url = store.get(feedUrlDraftAtom).trim()
    if (!url) return
    startTransition(async () => {
      try {
        await register.mutateAsync({ body: { feedUrl: url } })
        store.set(feedUrlDraftAtom, "")
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
    pending,
    submit,
  } as const
}
