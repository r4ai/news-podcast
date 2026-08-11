import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  ArticleArchiveStatusSchema,
  ArticleSchema,
  IdSchema,
  jsonContent,
  page,
  problemContent,
} from "../../http/schemas.js"
import { articleResponse } from "./presenter.js"
import {
  publishedRangeFields,
  publishedRangeRefinement,
  publishedRangeValid,
  toQueryArray,
} from "./shared.js"

const listArticlesQuery = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    q: z.string().min(1).max(200).optional(),
    state: z.enum(["all", "unread", "saved", "later"]).default("all"),
    feedIds: z.preprocess(toQueryArray, z.array(IdSchema)).optional(),
    sort: z.enum(["newest", "oldest", "source", "relevance"]).default("newest"),
    includeHidden: z.stringbool().optional(),
    usedInEpisode: z.stringbool().optional(),
    // sort=relevance以外でも使える。未処理（スコア無し）記事は満たさない扱い。
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    ...publishedRangeFields,
    archiveStatus: z
      .preprocess(toQueryArray, z.array(ArticleArchiveStatusSchema))
      .optional(),
    // 指定時、いずれかのタグが付いている記事のみ返す（OR条件）。
    tagIds: z.preprocess(toQueryArray, z.array(IdSchema)).optional(),
  })
  .refine(publishedRangeValid, publishedRangeRefinement)

export const listArticlesRoute = createRoute({
  method: "get",
  path: "/v1/me/articles",
  tags: ["Articles"],
  operationId: "listArticles",
  description: "List articles from the authenticated owner's subscriptions.",
  request: { query: listArticlesQuery },
  responses: {
    200: jsonContent(page(ArticleSchema), "Articles"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListArticles: RouteRegistrar = (app, dependencies) =>
  app.openapi(listArticlesRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const query = context.req.valid("query")
    const result = dependencies.store.listArticles(context.get("ownerId"), {
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
      ...(query.q ? { q: query.q } : {}),
      state: query.state,
      ...(query.feedIds ? { feedIds: query.feedIds } : {}),
      sort: query.sort,
      ...(query.includeHidden !== undefined
        ? { includeHidden: query.includeHidden }
        : {}),
      ...(query.usedInEpisode !== undefined
        ? { usedInEpisode: query.usedInEpisode }
        : {}),
      ...(query.minScore !== undefined ? { minScore: query.minScore } : {}),
      ...(query.publishedAfter ? { publishedAfter: query.publishedAfter } : {}),
      ...(query.publishedBefore
        ? { publishedBefore: query.publishedBefore }
        : {}),
      ...(query.archiveStatus ? { archiveStatus: query.archiveStatus } : {}),
      ...(query.tagIds ? { tagIds: query.tagIds } : {}),
    })
    return context.json(
      {
        items: result.items.map(articleResponse),
        page: {
          hasMore: result.hasMore,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
      },
      200
    )
  })
