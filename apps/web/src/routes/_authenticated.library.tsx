import { createFileRoute } from "@tanstack/react-router"

import { api } from "@/api/client"
import { LibraryPage } from "@/features/library/library-page"

export const Route = createFileRoute("/_authenticated/library")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      api.queryOptions("get", "/v1/episodes")
    ),
  component: LibraryPage,
})
