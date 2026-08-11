import { createRoute, z } from "@hono/zod-openapi"
import { streamSSE } from "hono/streaming"
import { encodeSse, toAgUiEvents } from "@news-podcast/contracts/agui"

import type { RouteRegistrar } from "../../http/context.js"
import { notFound, unavailable } from "../../http/problem.js"
import { problemContent } from "../../http/schemas.js"
import {
  JOB_STREAM_HEARTBEAT_MS,
  JOB_STREAM_MAX_MS,
  JOB_STREAM_POLL_MS,
  runPollingStream,
} from "../../http/sse.js"
import { toJobStateSnapshot } from "./presenter.js"
import { jobParams } from "./params.js"

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "canceled"])

export const jobEventsRoute = createRoute({
  method: "get",
  path: "/v1/episode-jobs/{jobId}/events",
  tags: ["Episode jobs"],
  operationId: "streamEpisodeJobEvents",
  description:
    "Stream generation progress as AG-UI events over SSE. The first event is always STATE_SNAPSHOT; pass Last-Event-ID to resume without gaps or duplicates.",
  request: {
    params: jobParams,
    query: z.object({
      lastEventId: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .openapi({ param: { name: "lastEventId", in: "query" } }),
    }),
    headers: z.object({
      "Last-Event-ID": z
        .string()
        .optional()
        .openapi({ param: { name: "Last-Event-ID", in: "header" } }),
    }),
  },
  responses: {
    200: {
      description: "AG-UI event stream",
      content: { "text/event-stream": { schema: z.string() } },
    },
    401: problemContent("Unauthorized"),
    404: problemContent("Not found"),
    503: problemContent("Unavailable"),
  },
})

export const registerJobEvents: RouteRegistrar = (app, dependencies) =>
  app.openapi(jobEventsRoute, (context) => {
    const store = dependencies.store
    if (!store) return unavailable(context)
    const ownerId = context.get("ownerId")
    const jobId = context.req.valid("param").jobId
    const job = store.getJob(ownerId, jobId)
    if (!job) return notFound(context)

    // EventSource は Last-Event-ID ヘッダを、fetch ベースのクライアントは
    // どちらでも送れる。ヘッダを優先する。
    const headerId = Number(context.req.valid("header")["Last-Event-ID"])
    const resumeFrom = Number.isFinite(headerId)
      ? headerId
      : (context.req.valid("query").lastEventId ?? 0)

    return streamSSE(context, async (stream) => {
      let cursor = resumeFrom

      // 再開時にスナップショットを送ると、クライアントが積み上げた
      // adoptedArticles を空で上書きしてしまう。新規接続のときだけ送る。
      if (cursor === 0) {
        await stream.write(
          encodeSse({
            event: {
              type: "STATE_SNAPSHOT",
              timestamp: Date.now(),
              snapshot: toJobStateSnapshot(job),
            },
          })
        )
      }

      await runPollingStream(
        stream,
        {
          pollMs: JOB_STREAM_POLL_MS,
          heartbeatMs: JOB_STREAM_HEARTBEAT_MS,
          maxMs: JOB_STREAM_MAX_MS,
        },
        async () => {
          const rows = store.listJobEventsAfter({
            ownerId,
            jobId,
            afterSequence: cursor,
          })
          for (const row of rows) {
            for (const event of toAgUiEvents(jobId, row)) {
              await stream.write(encodeSse({ id: row.sequence, event }))
            }
            cursor = row.sequence
          }
          // 残イベントを流し切ってから終端を判定する。順序を逆にすると
          // 最後の RUN_FINISHED を送る前に閉じてしまう。
          const current = store.getJob(ownerId, jobId)
          const done =
            rows.length === 0 &&
            (!current || TERMINAL_JOB_STATUSES.has(current.status))
          return { wrote: rows.length > 0, done }
        }
      )
    })
  })
