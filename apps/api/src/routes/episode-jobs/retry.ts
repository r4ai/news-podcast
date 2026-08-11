import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, problem, unavailable } from "../../http/problem.js"
import {
  JobReceiptSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import { jobParams } from "./params.js"

export const retryJobRoute = createRoute({
  method: "post",
  path: "/v1/episode-jobs/{jobId}/retry",
  tags: ["Episode jobs"],
  operationId: "retryEpisodeJob",
  description:
    "Create a new job from a failed job's feed, Memory, and policy snapshots.",
  request: { params: jobParams },
  responses: {
    202: jsonContent(JobReceiptSchema, "Accepted"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    409: problemContent("Job is not failed"),
    503: problemContent("Unavailable"),
  },
})

export const registerRetryJob: RouteRegistrar = (app, dependencies) =>
  app.openapi(retryJobRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const jobId = context.req.valid("param").jobId
    const original = dependencies.store.getJob(ownerId, jobId)
    if (!original) return notFound(context)
    const job = dependencies.store.retryFailedJob(ownerId, jobId)
    if (!job) {
      return context.json(
        problem(409, "job-not-failed", "Only failed jobs can be retried"),
        409
      )
    }
    context.header("Location", `/v1/episode-jobs/${job.id}`)
    context.header("Retry-After", "2")
    return context.json(
      {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
      },
      202
    )
  })
