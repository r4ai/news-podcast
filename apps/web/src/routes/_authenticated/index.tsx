import { createFileRoute } from "@tanstack/react-router"

import { episodesQueryOptions } from "@/features/episodes"
import { settingsQueryOptions } from "@/features/settings"
import {
  feedsQueryOptions,
  subscriptionsQueryOptions,
} from "@/features/subscriptions"
import { api } from "@/shared/api"
import { Panel } from "@/shared/components/panel"
import { pageTitle } from "@/shared/lib/page-title"
import { GenerationDashboard } from "./-home/components/generation-dashboard"

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: pageTitle("今日") }] }),
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(
      api.queryOptions("get", "/v1/episode-jobs")
    )
    void context.queryClient.ensureQueryData(episodesQueryOptions)
    void context.queryClient.ensureQueryData(settingsQueryOptions)
    void context.queryClient.ensureQueryData(subscriptionsQueryOptions)
    void context.queryClient.ensureQueryData(feedsQueryOptions)
  },
  component: HomeRoute,
})

function HomeRoute() {
  return (
    <Panel name="generation-dashboard">
      <GenerationDashboard />
    </Panel>
  )
}
