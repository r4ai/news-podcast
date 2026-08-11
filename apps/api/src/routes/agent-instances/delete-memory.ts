import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import { problemContent } from "../../http/schemas.js"
import { memoryParams } from "./params.js"

export const deleteAgentMemoryRoute = createRoute({
  method: "delete",
  path: "/v1/agent-instances/{agentId}/memories/{memoryId}",
  tags: ["Agent memory"],
  operationId: "deleteAgentMemory",
  description: "Soft-delete a Memory within the same owner and Agent scope.",
  request: { params: memoryParams },
  responses: {
    204: { description: "Deleted" },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerDeleteAgentMemory: RouteRegistrar = (app, dependencies) =>
  app.openapi(deleteAgentMemoryRoute, (context) => {
    if (!dependencies.agentRuntimeStore) return unavailable(context)
    const deleted = dependencies.agentRuntimeStore.deleteMemory(
      context.get("ownerId"),
      context.req.valid("param").agentId,
      context.req.valid("param").memoryId
    )
    return deleted ? context.body(null, 204) : notFound(context)
  })
