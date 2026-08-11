import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  AgentMemorySchema,
  jsonContent,
  page,
  problemContent,
} from "../../http/schemas.js"
import { toAgentMemoryResponse } from "./presenter.js"
import { agentParams } from "./params.js"

export const listAgentMemoriesRoute = createRoute({
  method: "get",
  path: "/v1/agent-instances/{agentId}/memories",
  tags: ["Agent memory"],
  operationId: "listAgentMemories",
  description: "List non-deleted Memory entries for one owned Agent instance.",
  request: { params: agentParams },
  responses: {
    200: jsonContent(page(AgentMemorySchema), "Agent memories"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListAgentMemories: RouteRegistrar = (app, dependencies) =>
  app.openapi(listAgentMemoriesRoute, (context) => {
    if (!dependencies.agentRuntimeStore) return unavailable(context)
    return context.json(
      {
        items: dependencies.agentRuntimeStore
          .listMemories(
            context.get("ownerId"),
            context.req.valid("param").agentId
          )
          .map(toAgentMemoryResponse),
        page: { hasMore: false as const },
      },
      200
    )
  })
