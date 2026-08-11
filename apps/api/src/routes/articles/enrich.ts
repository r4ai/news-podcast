import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, problem, unavailable } from "../../http/problem.js"
import {
  ArticleSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import { articleResponse } from "./presenter.js"
import { articleParams } from "./shared.js"

export const enrichArticleRoute = createRoute({
  method: "post",
  path: "/v1/me/articles/{articleId}/enrich",
  tags: ["Articles"],
  operationId: "enrichArticle",
  description:
    "Recompute the AI summary and relevance score for one article on demand.",
  request: { params: articleParams },
  responses: {
    200: jsonContent(ArticleSchema, "Recomputed"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    409: problemContent("Article is not archived yet"),
    503: problemContent("Unavailable"),
  },
})

export const registerEnrichArticle: RouteRegistrar = (app, dependencies) =>
  app.openapi(enrichArticleRoute, async (context) => {
    if (!dependencies.store || !dependencies.enrichArticle) {
      return unavailable(context)
    }
    const ownerId = context.get("ownerId")
    const articleId = context.req.valid("param").articleId
    const article = dependencies.store.getArticle(ownerId, articleId)
    if (!article) return notFound(context)
    let recomputed: boolean
    try {
      recomputed = await dependencies.enrichArticle(ownerId, articleId)
    } catch {
      return unavailable(context)
    }
    if (!recomputed) {
      return context.json(
        problem(409, "article-not-archived", "Article is not archived yet"),
        409
      )
    }
    const refreshed = dependencies.store.getArticle(ownerId, articleId)
    return refreshed
      ? context.json(articleResponse(refreshed), 200)
      : notFound(context)
  })
