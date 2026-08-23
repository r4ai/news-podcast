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

type FeedUrlValidation =
  | { readonly valid: true; readonly url: string }
  | { readonly valid: false; readonly message: string }

export function validateFeedUrlInput(value: string): FeedUrlValidation {
  const input = value.trim()
  try {
    const url = new URL(input)
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      input.includes("#") ||
      url.href.length > 2_048
    ) {
      return {
        valid: false,
        message:
          "安全上登録できないURLです。HTTP(S)を使い、認証情報と#以降を除いてください。",
      }
    }
    return { valid: true, url: input }
  } catch {
    return { valid: false, message: "URLの形式が正しくありません。" }
  }
}

export function feedRegistrationErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined
  switch (code) {
    case "invalid_subscription_request":
      return "URLの形式が正しくありません。"
    case "feed_subscription_rejected":
      return "このURLはRSS/Atomフィードとして登録できません。"
    case "feed_subscription_exists":
      return "このフィードは既に購読しています。"
    case "upstream_unavailable":
      return "現在フィードを登録できません。しばらくしてからもう一度お試しください。"
    default:
      return "RSSフィードを登録できませんでした。"
  }
}

export function useFeedRegistration() {
  const queryClient = useQueryClient()
  const register = api.useMutation("post", "/v1/feeds")
  // URLの中身は購読せずに読む。打鍵で購読フィード一覧まで描き直さないため。
  const store = useStore()
  const [pending, startTransition] = useTransition()

  function submit() {
    const validation = validateFeedUrlInput(store.get(feedUrlDraftAtom))
    if (!validation.valid) {
      toast.error(validation.message)
      return
    }
    startTransition(async () => {
      try {
        await register.mutateAsync({ body: { feedUrl: validation.url } })
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
      } catch (error) {
        toast.error(feedRegistrationErrorMessage(error))
      }
    })
  }

  return {
    pending,
    submit,
  } as const
}
