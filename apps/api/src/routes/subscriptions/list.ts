import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  jsonContent,
  page,
  problemContent,
  SubscriptionSchema,
} from "../../http/schemas.js"

export const listSubscriptionsRoute = createRoute({
  method: "get",
  path: "/v1/me/feed-subscriptions",
  tags: ["Subscriptions"],
  operationId: "listSubscriptions",
  description: "List the authenticated owner's feed subscriptions.",
  responses: {
    200: jsonContent(page(SubscriptionSchema), "Subscriptions"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListSubscriptions: RouteRegistrar = (app, dependencies) =>
  app.openapi(listSubscriptionsRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    return context.json(
      {
        items: dependencies.store.listSubscriptions(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })
