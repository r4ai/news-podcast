import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  AgentMemorySchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import { toAgentMemoryResponse } from "./presenter.js"
import { memoryParams } from "./params.js"

export const approveAgentMemoryRoute = createRoute({
  method: "post",
  path: "/v1/agent-instances/{agentId}/memories/{memoryId}/approve",
  tags: ["Agent memory"],
  operationId: "approveAgentMemory",
  description:
    "Activate a proposed Memory within the same owner and Agent scope.",
  request: { params: memoryParams },
  responses: {
    200: jsonContent(AgentMemorySchema, "Approved memory"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerApproveAgentMemory: RouteRegistrar = (app, dependencies) =>
  app.openapi(approveAgentMemoryRoute, async (context) => {
    if (!dependencies.agentRuntimeStore) return unavailable(context)
    const memory = await dependencies.agentRuntimeStore.decide({
      ownerId: context.get("ownerId"),
      agentInstanceId: context.req.valid("param").agentId,
      memoryId: context.req.valid("param").memoryId,
      decision: "approve",
    })
    return memory
      ? context.json(toAgentMemoryResponse(memory), 200)
      : notFound(context)
  })
