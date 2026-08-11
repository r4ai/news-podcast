import { z } from "@hono/zod-openapi"

import { IdSchema } from "../../http/schemas.js"

export const episodeParams = z.object({
  episodeId: IdSchema.openapi({ param: { name: "episodeId", in: "path" } }),
})
