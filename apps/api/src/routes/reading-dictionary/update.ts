import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import {
  IdSchema,
  jsonContent,
  problemContent,
  ReadingDictionaryEntrySchema,
  UpdateReadingDictionarySchema,
} from "../../http/schemas.js"
import { readingDictionaryResponse } from "./presenter.js"

export const updateReadingDictionaryRoute = createRoute({
  method: "put",
  path: "/v1/me/reading-dictionary/{id}",
  tags: ["Reading Dictionary"],
  operationId: "updateReadingDictionary",
  description: "Update a reading dictionary entry.",
  request: {
    params: z.object({ id: IdSchema }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateReadingDictionarySchema,
        },
      },
    },
  },
  responses: {
    200: jsonContent(ReadingDictionaryEntrySchema, "Updated"),
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerUpdateReadingDictionary: RouteRegistrar = (
  app,
  dependencies
) =>
  app.openapi(updateReadingDictionaryRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const { id } = context.req.valid("param")
    const body = context.req.valid("json")
    const entry = dependencies.store.updateReadingDictionary(ownerId, id, {
      surface: body.surface,
      reading: body.reading,
      accentType: body.accentType,
    })
    if (!entry) return notFound(context)
    return context.json(readingDictionaryResponse(entry), 200)
  })
