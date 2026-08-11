import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  ArticleArchiveStatusSchema,
  BulkArticleStateResultSchema,
  IdSchema,
  jsonContent,
  problemContent,
} from "../../http/schemas.js"
import {
  articleStateBody,
  hasAnyArticleStateFlag,
  publishedRangeFields,
  publishedRangeRefinement,
  publishedRangeValid,
} from "./shared.js"

const bulkArticleStateBody = z
  .object({
    q: z.string().min(1).max(200).optional(),
    state: z.enum(["all", "unread", "saved", "later"]).optional(),
    feedIds: z.array(IdSchema).optional(),
    includeHidden: z.boolean().optional(),
    ...publishedRangeFields,
    archiveStatus: z.array(ArticleArchiveStatusSchema).optional(),
  })
  .extend(articleStateBody.shape)
  .refine(hasAnyArticleStateFlag)
  .refine(publishedRangeValid, publishedRangeRefinement)

export const bulkArticleStateRoute = createRoute({
  method: "post",
  path: "/v1/me/articles/bulk-state",
  tags: ["Articles"],
  operationId: "bulkUpdateArticleState",
  description:
    "Apply read/saved/readLater/hidden state to every article matching a filter (e.g. mark all as read).",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: bulkArticleStateBody } },
    },
  },
  responses: {
    200: jsonContent(
      BulkArticleStateResultSchema,
      "Number of articles updated"
    ),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerBulkArticleState: RouteRegistrar = (app, dependencies) =>
  app.openapi(bulkArticleStateRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const body = context.req.valid("json")
    const updated = dependencies.store.bulkSetArticleState(
      context.get("ownerId"),
      {
        ...(body.q ? { q: body.q } : {}),
        ...(body.state ? { state: body.state } : {}),
        ...(body.feedIds ? { feedIds: body.feedIds } : {}),
        ...(body.includeHidden !== undefined
          ? { includeHidden: body.includeHidden }
          : {}),
        ...(body.publishedAfter ? { publishedAfter: body.publishedAfter } : {}),
        ...(body.publishedBefore
          ? { publishedBefore: body.publishedBefore }
          : {}),
        ...(body.archiveStatus ? { archiveStatus: body.archiveStatus } : {}),
      },
      {
        ...(body.read !== undefined ? { read: body.read } : {}),
        ...(body.saved !== undefined ? { saved: body.saved } : {}),
        ...(body.readLater !== undefined ? { readLater: body.readLater } : {}),
        ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
      }
    )
    return context.json({ updated }, 200)
  })
