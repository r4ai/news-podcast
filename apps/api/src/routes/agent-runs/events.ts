import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  AgentEventSchema,
  jsonContent,
  page,
  problemContent,
} from "../../http/schemas.js"
import { runParams } from "./params.js"

export const listAgentEventsRoute = createRoute({
  method: "get",
  path: "/v1/agent-runs/{runId}/events",
  tags: ["Agent runtime"],
  operationId: "listAgentRunEvents",
  description: "List the sanitized, versioned event timeline for an Agent run.",
  request: { params: runParams },
  responses: {
    200: jsonContent(page(AgentEventSchema), "Agent events"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerListAgentEvents: RouteRegistrar = (app, dependencies) =>
  app.openapi(listAgentEventsRoute, (context) => {
    if (!dependencies.agentRuntimeStore) return unavailable(context)
    const events = dependencies.agentRuntimeStore.listEvents(
      context.get("ownerId"),
      context.req.valid("param").runId
    )
    return events
      ? context.json(
          {
            items: events.map((event) => ({
              ...event,
              occurredAt: event.occurredAt.toISOString(),
            })),
            page: { hasMore: false as const },
          },
          200
        )
      : notFound(context)
  })
