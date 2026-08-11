import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import { problemContent } from "../../http/schemas.js"

export const audioRoute = createRoute({
  method: "get",
  path: "/v1/audio/{token}",
  tags: ["Episodes"],
  operationId: "getEpisodeAudio",
  description: "Stream WAV audio using a short-lived signed token and Range.",
  request: {
    params: z.object({
      token: z
        .string()
        .min(20)
        .openapi({ param: { name: "token", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "WAV audio",
      content: { "audio/wav": { schema: z.string() } },
    },
    206: {
      description: "Partial WAV audio",
      content: { "audio/wav": { schema: z.string() } },
    },
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerAudioStream: RouteRegistrar = (app, dependencies) =>
  app.openapi(audioRoute, (context) =>
    dependencies.serveAudio
      ? dependencies.serveAudio(
          context.req.valid("param").token,
          context.req.header("Range")
        )
      : unavailable(context)
  )
