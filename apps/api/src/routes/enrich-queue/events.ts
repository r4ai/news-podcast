import { createRoute, z } from "@hono/zod-openapi"
import { streamSSE } from "hono/streaming"
import { DEFAULT_AI_ENRICH_DAILY_LIMIT } from "@news-podcast/adapters/ai-enrich/shared"

import type { RouteRegistrar } from "../../http/context.js"
import { unavailable } from "../../http/problem.js"
import { problemContent } from "../../http/schemas.js"
import {
  ENRICH_STREAM_MAX_MS,
  JOB_STREAM_HEARTBEAT_MS,
  JOB_STREAM_POLL_MS,
  runPollingStream,
} from "../../http/sse.js"

export const enrichQueueEventsRoute = createRoute({
  method: "get",
  path: "/v1/me/enrich/queue/events",
  tags: ["AI enrichment"],
  operationId: "streamEnrichQueueEvents",
  description:
    "Stream the AI enrichment queue status as snapshots over SSE while it changes.",
  responses: {
    200: {
      description: "Enrich queue status snapshot stream",
      content: {
        "text/event-stream": { schema: z.string() },
      },
    },
    401: problemContent("Unauthorized"),
    503: problemContent("Unavailable"),
  },
})

export const registerEnrichQueueEvents: RouteRegistrar = (app, dependencies) =>
  app.openapi(enrichQueueEventsRoute, (context) => {
    const store = dependencies.store
    if (!store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const dailyLimit =
      dependencies.enrichDailyLimit ?? DEFAULT_AI_ENRICH_DAILY_LIMIT

    return streamSSE(context, async (stream) => {
      let last = ""
      await runPollingStream(
        stream,
        {
          pollMs: JOB_STREAM_POLL_MS,
          heartbeatMs: JOB_STREAM_HEARTBEAT_MS,
          maxMs: ENRICH_STREAM_MAX_MS,
        },
        async () => {
          const status = store.listEnrichQueueStatus(ownerId, dailyLimit)
          const snapshot = JSON.stringify({ type: "snapshot", data: status })
          if (snapshot === last) return { wrote: false, done: false }
          await stream.write(`event: snapshot\ndata: ${snapshot}\n\n`)
          last = snapshot
          return { wrote: true, done: false }
        }
      )
    })
  })
