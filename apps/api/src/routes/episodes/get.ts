import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  EpisodeSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import { episodeParams } from "./params.js"

export const getEpisodeRoute = createRoute({
  method: "get",
  path: "/v1/episodes/{episodeId}",
  tags: ["Episodes"],
  operationId: "getEpisode",
  description: "Return one completed episode with its sources.",
  request: { params: episodeParams },
  responses: {
    200: jsonContent(EpisodeSchema, "Episode"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerGetEpisode: RouteRegistrar = (app, dependencies) =>
  app.openapi(getEpisodeRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const episode = dependencies.store.getEpisode(
      context.get("ownerId"),
      context.req.valid("param").episodeId
    )
    return episode ? context.json(episode, 200) : notFound(context)
  })
