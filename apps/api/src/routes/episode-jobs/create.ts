import { createRoute, z } from "@hono/zod-openapi"
import { noopObservability } from "@news-podcast/observability"

import type { RouteRegistrar } from "../../http/context.js"
import { problem, unavailable } from "../../http/problem.js"
import {
  IdSchema,
  JobReceiptSchema,
  jsonContent,
  MAX_SELECTED_ARTICLES,
  problemContent,
} from "../../http/schemas.js"

export const createJobRoute = createRoute({
  method: "post",
  path: "/v1/episode-jobs",
  tags: ["Episode jobs"],
  operationId: "createEpisodeJob",
  description: "Create an idempotent asynchronous episode generation job.",
  request: {
    headers: z.object({
      "Idempotency-Key": z
        .string()
        .min(1)
        .max(255)
        .openapi({
          param: { name: "Idempotency-Key", in: "header" },
        }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            trigger: z.literal("manual"),
            articleIds: z
              .array(IdSchema)
              .min(1)
              .max(MAX_SELECTED_ARTICLES)
              .optional()
              .openapi({
                description:
                  "Restrict the episode to these archived articles. Omit for fully automatic selection.",
              }),
          }),
        },
      },
    },
  },
  responses: {
    202: jsonContent(JobReceiptSchema, "Accepted"),
    400: problemContent("Invalid"),
    401: problemContent("Unauthorized"),
    409: problemContent("Conflict"),
    422: problemContent("Unselectable articles"),
    503: problemContent("Unavailable"),
  },
})

export const registerCreateJob: RouteRegistrar = (app, dependencies) =>
  app.openapi(createJobRoute, async (context) => {
    if (!dependencies.createEpisodeJob) return unavailable(context)
    const observability = dependencies.observability ?? noopObservability
    const ownerId = context.get("ownerId")
    const articleIds: readonly string[] | undefined =
      context.req.valid("json").articleIds
    if (articleIds && dependencies.store) {
      // 他人の記事・購読停止中のフィード・アーカイブ未完了の記事を弾く。
      // エージェントは選択記事しか読めないので、ここを通すと必ず失敗する。
      const selectable = new Set(
        dependencies.store.filterSelectableArticleIds(ownerId, articleIds)
      )
      const rejected = articleIds.filter((id) => !selectable.has(id))
      if (rejected.length > 0) {
        return context.json(
          problem(
            422,
            "unselectable-articles",
            `Not available for generation: ${rejected.join(", ")}`
          ),
          422
        )
      }
    }
    try {
      const traceContext = observability.captureContext()
      const job = await dependencies.createEpisodeJob({
        ownerId,
        idempotencyKey: context.req.valid("header")["Idempotency-Key"],
        ...(articleIds ? { articleIds } : {}),
        ...(traceContext ? { traceContext } : {}),
      })
      observability.count("episode.requested")
      observability.log({
        name: "episode.requested",
        attributes: { trigger: "manual" },
      })
      context.header("Location", `/v1/episode-jobs/${job.id}`)
      context.header(
        "Idempotency-Key",
        context.req.valid("header")["Idempotency-Key"]
      )
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
    } catch (error) {
      return context.json(
        problem(409, "idempotency-conflict", String(error)),
        409
      )
    }
  })
