import { createRoute } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import {
  jsonContent,
  problemContent,
  SettingsSchema,
} from "../../http/schemas.js"

export const getSettingsRoute = createRoute({
  method: "get",
  path: "/v1/me/settings",
  tags: ["Settings"],
  operationId: "getSettings",
  description:
    "Return the authenticated owner's generation schedule and interest profile.",
  responses: {
    200: jsonContent(SettingsSchema, "Settings"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerGetSettings: RouteRegistrar = (app, dependencies) =>
  app.openapi(getSettingsRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    return context.json(
      {
        generationSchedule: dependencies.store.getSettings(ownerId),
        interestProfile: dependencies.store.getInterestProfile(ownerId),
      },
      200
    )
  })
