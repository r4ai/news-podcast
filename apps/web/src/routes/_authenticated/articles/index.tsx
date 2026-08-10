import { createFileRoute } from "@tanstack/react-router"

import { api } from "@/shared/api"
import { ArticlesPage } from "@/features/articles/articles-page"

export const Route = createFileRoute("/_authenticated/articles/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      api.queryOptions("get", "/v1/me/articles")
    ),
  component: ArticlesPage,
})
