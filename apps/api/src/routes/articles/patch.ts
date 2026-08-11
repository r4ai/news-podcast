import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  ArticleSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import { articleResponse } from "./presenter.js"
import {
  articleParams,
  articleStateBody,
  hasAnyArticleStateFlag,
} from "./shared.js"

export const patchArticleRoute = createRoute({
  method: "patch",
  path: "/v1/me/articles/{articleId}",
  tags: ["Articles"],
  operationId: "updateArticleState",
  description:
    "Update read, saved, readLater, or hidden state for one article.",
  request: {
    params: articleParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: articleStateBody.refine(hasAnyArticleStateFlag),
        },
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

export const registerPatchArticle: RouteRegistrar = (app, dependencies) =>
  app.openapi(patchArticleRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const article = dependencies.store.setArticleState(
      context.get("ownerId"),
      context.req.valid("param").articleId,
      context.req.valid("json")
    )
    return article
      ? context.json(articleResponse(article), 200)
      : notFound(context)
  })
