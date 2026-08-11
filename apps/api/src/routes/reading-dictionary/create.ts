import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  CreateReadingDictionarySchema,
  jsonContent,
  problemContent,
  ReadingDictionaryEntrySchema,
} from "../../http/schemas.js"
import { readingDictionaryResponse } from "./presenter.js"

export const createReadingDictionaryRoute = createRoute({
  method: "post",
  path: "/v1/me/reading-dictionary",
  tags: ["Reading Dictionary"],
  operationId: "createReadingDictionary",
  description: "Add a reading dictionary entry (idempotent by surface).",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateReadingDictionarySchema,
        },
      },
    },
  },
  responses: {
    201: jsonContent(ReadingDictionaryEntrySchema, "Created"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerCreateReadingDictionary: RouteRegistrar = (
  app,
  dependencies
) =>
  app.openapi(createReadingDictionaryRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const body = context.req.valid("json")
    const entry = dependencies.store.addReadingDictionary({
      ownerId,
      surface: body.surface,
      reading: body.reading,
      accentType: body.accentType,
      source: "manual",
    })
    context.header("Location", `/v1/me/reading-dictionary/${entry.id}`)
    return context.json(readingDictionaryResponse(entry), 201)
  })
