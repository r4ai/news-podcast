import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import { JobSchema, jsonContent, problemContent } from "../../http/schemas.js"
import { jobParams } from "./params.js"

export const getJobRoute = createRoute({
  method: "get",
  path: "/v1/episode-jobs/{jobId}",
  tags: ["Episode jobs"],
  operationId: "getEpisodeJob",
  description: "Return progress and retry state for one generation job.",
  request: { params: jobParams },
  responses: {
    200: jsonContent(JobSchema, "Job"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerGetJob: RouteRegistrar = (app, dependencies) =>
  app.openapi(getJobRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const job = dependencies.store.getJob(
      context.get("ownerId"),
      context.req.valid("param").jobId
    )
    return job ? context.json(job, 200) : notFound(context)
  })
