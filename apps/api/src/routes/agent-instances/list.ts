import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  AgentInstanceSchema,
  jsonContent,
  page,
  problemContent,
} from "../../http/schemas.js"

export const listAgentInstancesRoute = createRoute({
  method: "get",
  path: "/v1/agent-instances",
  tags: ["Agent memory"],
  operationId: "listAgentInstances",
  description: "List durable Agent instances owned by the authenticated user.",
  responses: {
    200: jsonContent(page(AgentInstanceSchema), "Agent instances"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListAgentInstances: RouteRegistrar = (app, dependencies) =>
  app.openapi(listAgentInstancesRoute, (context) => {
    if (!dependencies.agentRuntimeStore) return unavailable(context)
    return context.json(
      {
        items: dependencies.agentRuntimeStore
          .listInstances(context.get("ownerId"))
          .map((instance) => ({
            id: instance.id,
            agentKey: instance.agentKey,
            createdAt: instance.createdAt.toISOString(),
          })),
        page: { hasMore: false as const },
      },
      200
    )
  })
