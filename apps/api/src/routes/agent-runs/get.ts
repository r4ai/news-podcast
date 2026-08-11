import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  AgentRunSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import { toAgentRunResponse } from "./presenter.js"
import { runParams } from "./params.js"

export const getAgentRunRoute = createRoute({
  method: "get",
  path: "/v1/agent-runs/{runId}",
  tags: ["Agent runtime"],
  operationId: "getAgentRun",
  description: "Return one owner-scoped Agent run without private reasoning.",
  request: { params: runParams },
  responses: {
    200: jsonContent(AgentRunSchema, "Agent run"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerGetAgentRun: RouteRegistrar = (app, dependencies) =>
  app.openapi(getAgentRunRoute, async (context) => {
    if (!dependencies.agentRuntimeStore) return unavailable(context)
    const run = await dependencies.agentRuntimeStore.get(
      context.get("ownerId"),
      context.req.valid("param").runId
    )
    return run ? context.json(toAgentRunResponse(run), 200) : notFound(context)
  })
