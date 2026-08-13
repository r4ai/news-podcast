import { api } from "@/shared/api"

/** `/`（生成）と `/subscriptions` の両方が読む。 */
export const subscriptionsQueryOptions = api.queryOptions(
  "get",
  "/v1/me/feed-subscriptions"
)

export const feedsQueryOptions = api.queryOptions("get", "/v1/feeds", {
  params: { query: {} },
})

/** 購読直後の同期状態を画面間で共有する。 */
export const feedSyncJobsQueryOptions = api.queryOptions(
  "get",
  "/v1/me/feed-sync-jobs"
)
