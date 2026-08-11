import { z } from "@hono/zod-openapi"

import { IdSchema } from "../../http/schemas.js"

export const agentParams = z.object({
  agentId: IdSchema.openapi({ param: { name: "agentId", in: "path" } }),
})
export const memoryParams = agentParams.extend({
  memoryId: IdSchema.openapi({ param: { name: "memoryId", in: "path" } }),
})
