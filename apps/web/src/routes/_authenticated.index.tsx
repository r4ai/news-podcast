import { createFileRoute } from "@tanstack/react-router"

import { api } from "@/api/client"
import { GenerationPage } from "@/features/generation/generation-page"

export const Route = createFileRoute("/_authenticated/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        api.queryOptions("get", "/v1/episode-jobs")
      ),
      context.queryClient.ensureQueryData(
        api.queryOptions("get", "/v1/episodes")
      ),
      context.queryClient.ensureQueryData(
        api.queryOptions("get", "/v1/me/settings")
      ),
      context.queryClient.ensureQueryData(
        api.queryOptions("get", "/v1/me/feed-subscriptions")
      ),
      context.queryClient.ensureQueryData(
        api.queryOptions("get", "/v1/feeds", { params: { query: {} } })
      ),
    ]),
  component: GenerationPage,
})
