import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  jsonContent,
  page,
  problemContent,
  TagSuggestionSchema,
} from "../../http/schemas.js"

export const listTagSuggestionsRoute = createRoute({
  method: "get",
  path: "/v1/me/tag-suggestions",
  tags: ["Tags"],
  operationId: "listTagSuggestions",
  description:
    "List AI-proposed tag names that fell outside the owner's vocabulary, most frequent first.",
  responses: {
    200: jsonContent(page(TagSuggestionSchema), "Tag suggestions"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListTagSuggestions: RouteRegistrar = (app, dependencies) =>
  app.openapi(listTagSuggestionsRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    return context.json(
      {
        items: dependencies.store.listTagSuggestions(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })
