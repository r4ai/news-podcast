import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  ArticleSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import { articleResponse } from "./presenter.js"
import { articleParams } from "./shared.js"

export const getArticleRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/{articleId}",
  tags: ["Articles"],
  operationId: "getArticle",
  description: "Return one owner-scoped article and archive status.",
  request: { params: articleParams },
  responses: {
    200: jsonContent(ArticleSchema, "Article"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerGetArticle: RouteRegistrar = (app, dependencies) =>
  app.openapi(getArticleRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const article = dependencies.store.getArticle(
      context.get("ownerId"),
      context.req.valid("param").articleId
    )
    return article
      ? context.json(articleResponse(article), 200)
      : notFound(context)
  })
