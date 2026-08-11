import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { problem, unavailable } from "../../http/problem.js"
import {
  IdSchema,
  jsonContent,
  problemContent,
  SubscriptionSchema,
} from "../../http/schemas.js"

export const createSubscriptionRoute = createRoute({
  method: "post",
  path: "/v1/me/feed-subscriptions",
  tags: ["Subscriptions"],
  operationId: "createSubscription",
  description: "Subscribe the authenticated owner to a catalog feed.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ feedId: IdSchema }) },
      },
    },
  },
  responses: {
    201: jsonContent(SubscriptionSchema, "Created"),
    401: problemContent("Unauthorized"),
    409: problemContent("Conflict"),
    503: problemContent("Unavailable"),
  },
})

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint")
}

export const registerCreateSubscription: RouteRegistrar = (app, dependencies) =>
  app.openapi(createSubscriptionRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    try {
      const subscription = dependencies.store.createSubscription(
        context.get("ownerId"),
        context.req.valid("json").feedId
      )
      context.header("Location", `/v1/me/feed-subscriptions/${subscription.id}`)
      return context.json(subscription, 201)
    } catch (error) {
      const code = isUniqueConstraint(error)
        ? "subscription-exists"
        : "feed-not-found"
      return context.json(problem(409, code, "Subscription conflict"), 409)
    }
  })
