import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { problem, unavailable } from "../../http/problem.js"
import {
  FeedSchema,
  jsonContent,
  problemContent,
  SubscriptionSchema,
} from "../../http/schemas.js"

export const registerFeedRoute = createRoute({
  method: "post",
  path: "/v1/feeds",
  tags: ["Feeds"],
  operationId: "registerFeed",
  description: "Discover, register, and subscribe to an arbitrary RSS URL.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ feedUrl: z.url() }),
        },
      },
    },
  },
  responses: {
    201: jsonContent(
      z.object({ feed: FeedSchema, subscription: SubscriptionSchema }),
      "Registered"
    ),
    401: problemContent("Unauthorized"),
    422: problemContent("Feed discovery failed"),
    503: problemContent("Unavailable"),
  },
})

export const registerRegisterFeed: RouteRegistrar = (app, dependencies) =>
  app.openapi(registerFeedRoute, async (context) => {
    if (!dependencies.discoverFeed) return unavailable(context)
    try {
      const result = await dependencies.discoverFeed(
        context.get("ownerId"),
        context.req.valid("json").feedUrl
      )
      context.header("Location", `/v1/feeds/${result.feed.id}`)
      return context.json(result, 201)
    } catch {
      return context.json(
        problem(422, "feed-discovery-failed", "Feed discovery failed"),
        422
      )
    }
  })
