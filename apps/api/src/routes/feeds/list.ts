import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  FeedSchema,
  jsonContent,
  page,
  problemContent,
} from "../../http/schemas.js"

export const listFeedsRoute = createRoute({
  method: "get",
  path: "/v1/feeds",
  tags: ["Feeds"],
  operationId: "listFeeds",
  description: "Search the configured RSS feed catalog.",
  request: { query: z.object({ q: z.string().min(1).max(200).optional() }) },
  responses: {
    200: jsonContent(page(FeedSchema), "Feed catalog"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListFeeds: RouteRegistrar = (app, dependencies) =>
  app.openapi(listFeedsRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const { q } = context.req.valid("query")
    return context.json(
      {
        items: dependencies.store.listVisibleFeeds(context.get("ownerId"), q),
        page: { hasMore: false },
      },
      200
    )
  })
