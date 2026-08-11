import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { problem, unavailable } from "../../http/problem.js"
import { jsonContent, problemContent } from "../../http/schemas.js"

export const enrichResetDailyRoute = createRoute({
  method: "post",
  path: "/v1/me/enrich/reset-daily",
  tags: ["AI enrichment"],
  operationId: "enrichResetDaily",
  description:
    "Reset the daily AI enrichment usage counter for development convenience.",
  responses: {
    200: jsonContent(z.object({ message: z.string() }), "Confirmation message"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerEnrichResetDaily: RouteRegistrar = (app, dependencies) =>
  app.openapi(enrichResetDailyRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    if (process.env.NODE_ENV === "production") {
      return context.json(
        problem(503, "unavailable", "Only available in development"),
        503
      )
    }
    dependencies.store.resetEnrichProcessedToday(
      new Date().toISOString().slice(0, 10)
    )
    return context.json({ message: "Daily limit reset" }, 200)
  })
