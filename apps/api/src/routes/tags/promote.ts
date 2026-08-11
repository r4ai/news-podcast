import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  jsonContent,
  problemContent,
  TagNameSchema,
  TagSchema,
} from "../../http/schemas.js"

export const promoteTagSuggestionRoute = createRoute({
  method: "post",
  path: "/v1/me/tag-suggestions/promote",
  tags: ["Tags"],
  operationId: "promoteTagSuggestion",
  description:
    "Turn a suggested tag name into a real vocabulary tag and remove the suggestion.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ name: TagNameSchema }) },
      },
    },
  },
  responses: {
    201: jsonContent(TagSchema, "Promoted"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerPromoteTagSuggestion: RouteRegistrar = (
  app,
  dependencies
) =>
  app.openapi(promoteTagSuggestionRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const tag = dependencies.store.promoteTagSuggestion(
      context.get("ownerId"),
      context.req.valid("json").name
    )
    if (!tag) return notFound(context)
    context.header("Location", `/v1/me/tags/${tag.id}`)
    return context.json(tag, 201)
  })
