import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  ArticleSchema,
  IdSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import { articleResponse } from "./presenter.js"
import { articleParams } from "./shared.js"

// 記事の手動タグ集合を丸ごと置き換える。AI付与タグは別枠で維持される
// （LocalStore.setArticleManualTagsを参照）。
export const putArticleTagsRoute = createRoute({
  method: "put",
  path: "/v1/me/articles/{articleId}/tags",
  tags: ["Articles"],
  operationId: "setArticleTags",
  description: "Replace the manual tag set for one article.",
  request: {
    params: articleParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ tagIds: z.array(IdSchema) }) },
      },
    },
  },
  responses: {
    200: jsonContent(ArticleSchema, "Updated"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerPutArticleTags: RouteRegistrar = (app, dependencies) =>
  app.openapi(putArticleTagsRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const articleId = context.req.valid("param").articleId
    if (!dependencies.store.getArticle(ownerId, articleId)) {
      return notFound(context)
    }
    dependencies.store.setArticleManualTags(
      ownerId,
      articleId,
      context.req.valid("json").tagIds
    )
    const article = dependencies.store.getArticle(ownerId, articleId)
    return article
      ? context.json(articleResponse(article), 200)
      : notFound(context)
  })
