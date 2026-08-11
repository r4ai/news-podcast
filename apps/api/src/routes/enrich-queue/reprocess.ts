import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import { jsonContent, problemContent } from "../../http/schemas.js"

export const enrichReprocessRoute = createRoute({
  method: "post",
  path: "/v1/me/enrich/reprocess",
  tags: ["AI enrichment"],
  operationId: "enrichReprocess",
  description:
    "Explicitly enqueue all already-processed articles for AI enrichment again.",
  responses: {
    200: jsonContent(
      z.object({ enqueued: z.number().int().nonnegative() }),
      "Number of enqueued articles"
    ),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerEnrichReprocess: RouteRegistrar = (app, dependencies) =>
  app.openapi(enrichReprocessRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const enqueued = dependencies.store.enqueueReprocess(ownerId)
    return context.json({ enqueued }, 200)
  })
