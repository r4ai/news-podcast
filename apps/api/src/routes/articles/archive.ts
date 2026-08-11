import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import { problemContent } from "../../http/schemas.js"
import { articleParams } from "./shared.js"

export const articleArchiveRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/{articleId}/archive",
  tags: ["Articles"],
  operationId: "getArticleArchive",
  description: "Return sanitized replay HTML with external scripts disabled.",
  request: { params: articleParams },
  responses: {
    200: {
      description: "Sanitized replay HTML",
      content: { "text/html": { schema: z.string() } },
    },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerArticleArchive: RouteRegistrar = (app, dependencies) =>
  app.openapi(articleArchiveRoute, (context) =>
    dependencies.serveArticleArchive
      ? dependencies.serveArticleArchive(
          context.get("ownerId"),
          context.req.valid("param").articleId
        )
      : unavailable(context)
  )
