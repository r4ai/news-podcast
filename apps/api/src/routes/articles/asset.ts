import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import { problemContent } from "../../http/schemas.js"
import { articleParams } from "./shared.js"

export const articleAssetRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/{articleId}/assets/{hash}",
  tags: ["Articles"],
  operationId: "getArticleAsset",
  description:
    "Return one owner-scoped asset captured with an article snapshot.",
  request: {
    params: articleParams.extend({
      hash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .openapi({ param: { name: "hash", in: "path" } }),
    }),
  },
  responses: {
    200: {
      description: "Archived asset",
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerArticleAsset: RouteRegistrar = (app, dependencies) =>
  app.openapi(articleAssetRoute, (context) =>
    dependencies.serveArticleAsset
      ? dependencies.serveArticleAsset(
          context.get("ownerId"),
          context.req.valid("param").articleId,
          context.req.valid("param").hash
        )
      : unavailable(context)
  )
