import { createFileRoute } from "@tanstack/react-router"

import { api } from "@/shared/api"
import { SchedulePage } from "@/features/schedule/schedule-page"

export const Route = createFileRoute("/_authenticated/schedule/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      api.queryOptions("get", "/v1/me/settings")
    ),
  component: SchedulePage,
})
