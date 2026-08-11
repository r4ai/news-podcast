import { z } from "@hono/zod-openapi"

import { IdSchema } from "../../http/schemas.js"

export const jobParams = z.object({
  jobId: IdSchema.openapi({ param: { name: "jobId", in: "path" } }),
})
