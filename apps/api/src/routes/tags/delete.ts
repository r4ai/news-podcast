import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import { IdSchema, problemContent } from "../../http/schemas.js"

const tagParams = z.object({
  tagId: IdSchema.openapi({ param: { name: "tagId", in: "path" } }),
})

export const deleteTagRoute = createRoute({
  method: "delete",
  path: "/v1/me/tags/{tagId}",
  tags: ["Tags"],
  operationId: "deleteTag",
  description: "Remove one tag from the owner's vocabulary.",
  request: { params: tagParams },
  responses: {
    204: { description: "Deleted" },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerDeleteTag: RouteRegistrar = (app, dependencies) =>
  app.openapi(deleteTagRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    return dependencies.store.deleteTag(
      context.get("ownerId"),
      context.req.valid("param").tagId
    )
      ? context.body(null, 204)
      : notFound(context)
  })
