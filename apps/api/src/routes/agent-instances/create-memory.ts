import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  AgentMemorySchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import { toAgentMemoryResponse } from "./presenter.js"
import { agentParams } from "./params.js"

const memoryInput = z.object({
  kind: z.enum(["preference", "working_note"]),
  content: z.record(z.string(), z.unknown()),
  expiresAt: z.iso.datetime().optional(),
})

export const createAgentMemoryRoute = createRoute({
  method: "post",
  path: "/v1/agent-instances/{agentId}/memories",
  tags: ["Agent memory"],
  operationId: "createAgentMemory",
  description: "Propose a preference or working note for later approval.",
  request: {
    params: agentParams,
    body: {
      required: true,
      content: { "application/json": { schema: memoryInput } },
    },
  },
  responses: {
    201: jsonContent(AgentMemorySchema, "Memory proposal"),
    400: problemContent("Invalid"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerCreateAgentMemory: RouteRegistrar = (app, dependencies) =>
  app.openapi(createAgentMemoryRoute, async (context) => {
    if (!dependencies.agentRuntimeStore) return unavailable(context)
    try {
      const body = context.req.valid("json")
      const memory = await dependencies.agentRuntimeStore.propose({
        ownerId: context.get("ownerId"),
        agentInstanceId: context.req.valid("param").agentId,
        kind: body.kind,
        content: body.content,
        ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
      })
      return context.json(toAgentMemoryResponse(memory), 201)
    } catch {
      return notFound(context)
    }
  })
