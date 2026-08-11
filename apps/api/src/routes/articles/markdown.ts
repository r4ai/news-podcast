import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import { problemContent } from "../../http/schemas.js"
import { articleParams } from "./shared.js"

export const articleMarkdownRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/{articleId}/markdown",
  tags: ["Articles"],
  operationId: "getArticleMarkdown",
  description: "Return the archived Markdown used by the Podcast Agent.",
  request: { params: articleParams },
  responses: {
    200: {
      description: "Archived article Markdown",
      content: { "text/markdown": { schema: z.string() } },
    },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerArticleMarkdown: RouteRegistrar = (app, dependencies) =>
  app.openapi(articleMarkdownRoute, (context) =>
    dependencies.serveArticleMarkdown
      ? dependencies.serveArticleMarkdown(
          context.get("ownerId"),
          context.req.valid("param").articleId
        )
      : unavailable(context)
  )
