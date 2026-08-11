import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  jsonContent,
  problemContent,
  TagNameSchema,
  TagSchema,
} from "../../http/schemas.js"

export const createTagRoute = createRoute({
  method: "post",
  path: "/v1/me/tags",
  tags: ["Tags"],
  operationId: "createTag",
  description: "Add a tag to the owner's vocabulary (idempotent by name).",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ name: TagNameSchema }) },
      },
    },
  },
  responses: {
    201: jsonContent(TagSchema, "Created"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerCreateTag: RouteRegistrar = (app, dependencies) =>
  app.openapi(createTagRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const tag = dependencies.store.createTag(
      context.get("ownerId"),
      context.req.valid("json").name
    )
    context.header("Location", `/v1/me/tags/${tag.id}`)
    return context.json(tag, 201)
  })
