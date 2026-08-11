import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../http/context.js"
import { jsonContent } from "../http/schemas.js"

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  operationId: "getHealth",
  description: "Return process liveness without credentials.",
  responses: {
    200: jsonContent(z.object({ status: z.literal("ok") }), "Alive"),
  },
})

export const registerHealth: RouteRegistrar = (app) =>
  app.openapi(healthRoute, (context) => context.json({ status: "ok" }, 200))
