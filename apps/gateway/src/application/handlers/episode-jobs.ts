import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"

import { gatewayApi } from "../../contract.js"
import type { GatewayHandlers } from "./definitions.js"

/** エピソード生成ジョブの受付・照会・取り消しと、進捗のストリーミング。 */
export const episodeJobsGroup = (handlers: GatewayHandlers) =>
  HttpApiBuilder.group(gatewayApi, "episodeJobs", (group) =>
    group
      .handle("createEpisodeJob", ({ headers, payload }) =>
        handlers.createEpisodeJob({ headers, payload }).pipe(
          Effect.map((receipt) =>
            HttpApiSchema.withHeaders({
              body: receipt,
              headers: { Location: `/v1/episode-jobs/${receipt.id}` },
            })
          )
        )
      )
      .handle("listEpisodeJobs", ({ headers, query }) =>
        handlers.listEpisodeJobs({
          headers,
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        })
      )
      .handle("getEpisodeJob", ({ headers, params }) =>
        handlers.getEpisodeJob({ headers, jobId: params.jobId })
      )
      .handle("cancelEpisodeJob", ({ headers, params }) =>
        handlers.cancelEpisodeJob({ headers, jobId: params.jobId })
      )
      .handle("retryEpisodeJob", ({ headers, params }) =>
        handlers.retryEpisodeJob({
          headers,
          jobId: params.jobId,
          idempotencyKey: headers["idempotency-key"] ?? `retry:${params.jobId}`,
        })
      )
      .handle("streamEpisodeJobEvents", ({ headers, params, query }) => {
        const headerSequence = Number(headers["last-event-id"])
        return handlers.streamEpisodeJobEvents({
          headers: {
            ...(headers.authorization === undefined
              ? {}
              : { authorization: headers.authorization }),
            ...(headers.cookie === undefined ? {} : { cookie: headers.cookie }),
            ...(headers.traceparent === undefined
              ? {}
              : { traceparent: headers.traceparent }),
          },
          jobId: params.jobId,
          afterSequence:
            Number.isSafeInteger(headerSequence) && headerSequence >= 0
              ? headerSequence
              : (query.lastEventId ?? 0),
        })
      })
  )
