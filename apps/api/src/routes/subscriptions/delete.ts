import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import { problemContent } from "../../http/schemas.js"
import { subscriptionParams } from "./patch.js"

export const deleteSubscriptionRoute = createRoute({
  method: "delete",
  path: "/v1/me/feed-subscriptions/{subscriptionId}",
  tags: ["Subscriptions"],
  operationId: "deleteSubscription",
  description: "Delete one owner-scoped subscription.",
  request: { params: subscriptionParams },
  responses: {
    204: { description: "Deleted" },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerDeleteSubscription: RouteRegistrar = (app, dependencies) =>
  app.openapi(deleteSubscriptionRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    return dependencies.store.deleteSubscription(
      context.get("ownerId"),
      context.req.valid("param").subscriptionId
    )
      ? context.body(null, 204)
      : notFound(context)
  })
