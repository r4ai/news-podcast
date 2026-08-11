import { createRoute } from "@hono/zod-openapi"
import { noopObservability } from "@news-podcast/observability"

import type { RouteRegistrar } from "../../http/context.js"
import { problem, unavailable } from "../../http/problem.js"
import { JobSchema, jsonContent, problemContent } from "../../http/schemas.js"
import { jobParams } from "./params.js"

export const cancelJobRoute = createRoute({
  method: "post",
  path: "/v1/episode-jobs/{jobId}/cancel",
  tags: ["Episode jobs"],
  operationId: "cancelEpisodeJob",
  description:
    "Cancel queued, running, or retrying work and stop its active sandbox session.",
  request: { params: jobParams },
  responses: {
    200: jsonContent(JobSchema, "Canceled"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    409: problemContent("Already terminal"),
    503: problemContent("Unavailable"),
  },
})

export const registerCancelJob: RouteRegistrar = (app, dependencies) =>
  app.openapi(cancelJobRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const observability = dependencies.observability ?? noopObservability
    const ownerId = context.get("ownerId")
    const jobId = context.req.valid("param").jobId
    const result = dependencies.store.cancelJob(ownerId, jobId)
    if (result === "not_found") {
      return context.json(problem(404, "not-found", "Not found"), 404)
    }
    if (result === "terminal") {
      return context.json(
        problem(409, "job-terminal", "Terminal jobs cannot be canceled"),
        409
      )
    }
    observability.count("episode.canceled")
    return context.json(dependencies.store.getJob(ownerId, jobId)!, 200)
  })
