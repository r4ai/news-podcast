import { z } from "@hono/zod-openapi"

import { IdSchema } from "../../http/schemas.js"

export const runParams = z.object({
  runId: IdSchema.openapi({ param: { name: "runId", in: "path" } }),
})
