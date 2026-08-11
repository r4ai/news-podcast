import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  IdSchema,
  jsonContent,
  problemContent,
  SubscriptionSchema,
} from "../../http/schemas.js"

export const subscriptionParams = z.object({
  subscriptionId: IdSchema.openapi({
    param: { name: "subscriptionId", in: "path" },
  }),
})

export const patchSubscriptionRoute = createRoute({
  method: "patch",
  path: "/v1/me/feed-subscriptions/{subscriptionId}",
  tags: ["Subscriptions"],
  operationId: "updateSubscription",
  description: "Enable or pause one owner-scoped subscription.",
  request: {
    params: subscriptionParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ enabled: z.boolean() }) },
      },
    },
  },
  responses: {
    200: jsonContent(SubscriptionSchema, "Updated"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerPatchSubscription: RouteRegistrar = (app, dependencies) =>
  app.openapi(patchSubscriptionRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const subscription = dependencies.store.setSubscriptionEnabled(
      context.get("ownerId"),
      context.req.valid("param").subscriptionId,
      context.req.valid("json").enabled
    )
    return subscription ? context.json(subscription, 200) : notFound(context)
  })
