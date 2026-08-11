import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  EpisodeSchema,
  jsonContent,
  page,
  problemContent,
} from "../../http/schemas.js"

export const listEpisodesRoute = createRoute({
  method: "get",
  path: "/v1/episodes",
  tags: ["Episodes"],
  operationId: "listEpisodes",
  description: "List completed episodes for the authenticated owner.",
  responses: {
    200: jsonContent(page(EpisodeSchema), "Episodes"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListEpisodes: RouteRegistrar = (app, dependencies) =>
  app.openapi(listEpisodesRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    return context.json(
      {
        items: dependencies.store.listEpisodes(context.get("ownerId")),
        page: { hasMore: false },
      },
      200
    )
  })
