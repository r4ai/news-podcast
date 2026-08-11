import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  ArticleArchiveStatusSchema,
  ArticleFacetsSchema,
  IdSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import {
  publishedRangeFields,
  publishedRangeRefinement,
  publishedRangeValid,
  toQueryArray,
} from "./shared.js"

const articleFacetsQuery = z
  .object({
    q: z.string().min(1).max(200).optional(),
    feedIds: z.preprocess(toQueryArray, z.array(IdSchema)).optional(),
    includeHidden: z.stringbool().optional(),
    ...publishedRangeFields,
    archiveStatus: z
      .preprocess(toQueryArray, z.array(ArticleArchiveStatusSchema))
      .optional(),
    tagIds: z.preprocess(toQueryArray, z.array(IdSchema)).optional(),
  })
  .refine(publishedRangeValid, publishedRangeRefinement)

export const articleFacetsRoute = createRoute({
  method: "get",
  path: "/v1/me/articles/facets",
  tags: ["Articles"],
  operationId: "getArticleFacets",
  description:
    "Return state and per-feed counts for the current search/filter scope.",
  request: { query: articleFacetsQuery },
  responses: {
    200: jsonContent(ArticleFacetsSchema, "Article facets"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerArticleFacets: RouteRegistrar = (app, dependencies) =>
  app.openapi(articleFacetsRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const query = context.req.valid("query")
    const facets = dependencies.store.listArticleFacets(
      context.get("ownerId"),
      {
        ...(query.q ? { q: query.q } : {}),
        ...(query.feedIds ? { feedIds: query.feedIds } : {}),
        ...(query.includeHidden !== undefined
          ? { includeHidden: query.includeHidden }
          : {}),
        ...(query.publishedAfter
          ? { publishedAfter: query.publishedAfter }
          : {}),
        ...(query.publishedBefore
          ? { publishedBefore: query.publishedBefore }
          : {}),
        ...(query.archiveStatus ? { archiveStatus: query.archiveStatus } : {}),
        ...(query.tagIds ? { tagIds: query.tagIds } : {}),
      }
    )
    return context.json(facets, 200)
  })
