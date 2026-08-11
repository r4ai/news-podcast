import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  jsonContent,
  page,
  problemContent,
  TagSchema,
} from "../../http/schemas.js"

export const listTagsRoute = createRoute({
  method: "get",
  path: "/v1/me/tags",
  tags: ["Tags"],
  operationId: "listTags",
  description:
    "List the authenticated owner's tag vocabulary (used both for manual tagging and as the AI candidate set).",
  responses: {
    200: jsonContent(page(TagSchema), "Tags"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListTags: RouteRegistrar = (app, dependencies) =>
  app.openapi(listTagsRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    return context.json(
      {
        items: dependencies.store.listTags(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })
