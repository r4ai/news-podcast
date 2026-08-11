import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  jsonContent,
  page,
  problemContent,
  ReadingDictionaryEntrySchema,
} from "../../http/schemas.js"
import { readingDictionaryResponse } from "./presenter.js"

export const listReadingDictionaryRoute = createRoute({
  method: "get",
  path: "/v1/me/reading-dictionary",
  tags: ["Reading Dictionary"],
  operationId: "listReadingDictionary",
  description:
    "List the authenticated owner's reading dictionary entries (surface→reading mappings for TTS).",
  responses: {
    200: jsonContent(page(ReadingDictionaryEntrySchema), "Reading dictionary"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerListReadingDictionary: RouteRegistrar = (
  app,
  dependencies
) =>
  app.openapi(listReadingDictionaryRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    return context.json(
      {
        items: dependencies.store
          .listReadingDictionary(ownerId)
          .map(readingDictionaryResponse),
        page: { hasMore: false },
      },
      200
    )
  })
