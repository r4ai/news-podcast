import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import { IdSchema, problemContent } from "../../http/schemas.js"

export const deleteReadingDictionaryRoute = createRoute({
  method: "delete",
  path: "/v1/me/reading-dictionary/{id}",
  tags: ["Reading Dictionary"],
  operationId: "deleteReadingDictionary",
  description: "Delete a reading dictionary entry.",
  request: { params: z.object({ id: IdSchema }) },
  responses: {
    204: { description: "Deleted" },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerDeleteReadingDictionary: RouteRegistrar = (
  app,
  dependencies
) =>
  app.openapi(deleteReadingDictionaryRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const { id } = context.req.valid("param")
    return dependencies.store.deleteReadingDictionary(ownerId, id)
      ? context.body(null, 204)
      : notFound(context)
  })
