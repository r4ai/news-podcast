import { api } from "@/shared/api"

/** `/`（生成）と `/subscriptions` の両方が読む。 */
export const subscriptionsQueryOptions = api.queryOptions(
  "get",
  "/v1/me/feed-subscriptions"
)

export const feedsQueryOptions = api.queryOptions("get", "/v1/feeds", {
  params: { query: {} },
})
