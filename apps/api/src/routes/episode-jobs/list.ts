import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  JobSchema,
  jsonContent,
  page,
  problemContent,
} from "../../http/schemas.js"

export const listJobsRoute = createRoute({
  method: "get",
  path: "/v1/episode-jobs",
  tags: ["Episode jobs"],
  operationId: "listEpisodeJobs",
  description: "List recent generation jobs for the authenticated owner.",
  responses: {
    200: jsonContent(page(JobSchema), "Jobs"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListJobs: RouteRegistrar = (app, dependencies) =>
  app.openapi(listJobsRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    return context.json(
      {
        items: dependencies.store.listJobs(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })
