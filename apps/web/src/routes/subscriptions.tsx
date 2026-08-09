import { createFileRoute } from "@tanstack/react-router"

import { api } from "@/api/client"
import { SubscriptionsPage } from "@/features/subscriptions/subscriptions-page"

export const Route = createFileRoute("/subscriptions")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        api.queryOptions("get", "/v1/me/feed-subscriptions")
      ),
      context.queryClient.ensureQueryData(
        api.queryOptions("get", "/v1/feeds", { params: { query: {} } })
      ),
    ]),
  component: SubscriptionsPage,
})
