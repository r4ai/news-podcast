import { createRoute, z } from "@hono/zod-openapi"

import type { RouteRegistrar } from "../../http/context.js"
import { problem, unavailable } from "../../http/problem.js"
import {
  InterestProfileSchema,
  jsonContent,
  problemContent,
  ScheduleSchema,
  SettingsSchema,
} from "../../http/schemas.js"
import { isValidTimeZone } from "./time-zone.js"

export const patchSettingsRoute = createRoute({
  method: "patch",
  path: "/v1/me/settings",
  tags: ["Settings"],
  operationId: "updateSettings",
  description:
    "Update the authenticated owner's generation schedule and/or interest profile.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            generationSchedule: ScheduleSchema.optional(),
            interestProfile: InterestProfileSchema.optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonContent(SettingsSchema, "Updated"),
    400: problemContent("Invalid"),
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerPatchSettings: RouteRegistrar = (app, dependencies) =>
  app.openapi(patchSettingsRoute, (context) => {
    if (!dependencies.store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const body = context.req.valid("json")
    if (body.generationSchedule) {
      if (!isValidTimeZone(body.generationSchedule.timeZone)) {
        return context.json(
          problem(400, "invalid-time-zone", "Invalid time zone"),
          400
        )
      }
      dependencies.store.setSettings(ownerId, body.generationSchedule)
    }
    if (body.interestProfile) {
      dependencies.store.setInterestProfile(ownerId, body.interestProfile)
    }
    return context.json(
      {
        generationSchedule: dependencies.store.getSettings(ownerId),
        interestProfile: dependencies.store.getInterestProfile(ownerId),
      },
      200
    )
  })
