import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import { jsonContent, problemContent } from "../../http/schemas.js"
import { episodeParams } from "./params.js"

export const audioAccessRoute = createRoute({
  method: "post",
  path: "/v1/episodes/{episodeId}/audio-access",
  tags: ["Episodes"],
  operationId: "createAudioAccess",
  description: "Issue a short-lived owner-scoped audio URL.",
  request: { params: episodeParams },
  responses: {
    200: jsonContent(
      z.object({ url: z.url(), expiresAt: z.iso.datetime() }),
      "Short-lived audio access"
    ),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerAudioAccess: RouteRegistrar = (app, dependencies) =>
  app.openapi(audioAccessRoute, async (context) => {
    if (!dependencies.issueAudioAccess) return unavailable(context)
    const access = await dependencies.issueAudioAccess(
      context.get("ownerId"),
      context.req.valid("param").episodeId
    )
    if (!access) return notFound(context)
    context.header("Cache-Control", "private, no-store")
    return context.json(access, 200)
  })
