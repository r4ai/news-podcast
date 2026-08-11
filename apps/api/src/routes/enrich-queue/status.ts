import { createRoute } from "@hono/zod-openapi"
import { DEFAULT_AI_ENRICH_DAILY_LIMIT } from "@news-podcast/adapters/ai-enrich/shared"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  EnrichQueueSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"

export const enrichQueueRoute = createRoute({
  method: "get",
  path: "/v1/me/enrich/queue",
  tags: ["AI enrichment"],
  operationId: "getEnrichQueue",
  description:
    "Return the AI enrichment queue status: processing, pending, failed, recent, and the daily budget.",
  responses: {
    200: jsonContent(EnrichQueueSchema, "Enrich queue status"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerEnrichQueueStatus: RouteRegistrar = (app, dependencies) =>
  app.openapi(enrichQueueRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const status = dependencies.store.listEnrichQueueStatus(
      ownerId,
      dependencies.enrichDailyLimit ?? DEFAULT_AI_ENRICH_DAILY_LIMIT
    )
    return context.json(status, 200)
  })
