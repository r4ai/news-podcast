import { deepFreeze } from "@news-podcast/kernel"
import { Effect, Layer, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"

import { gatewayApi } from "./contract.js"
import type { GatewayPorts } from "./ports.js"

const freezeSuccess = <Success, Error, Requirements>(
  effect: Effect.Effect<Success, Error, Requirements>
) => effect.pipe(Effect.map(deepFreeze))

export const makeGatewayHandlers = (ports: GatewayPorts) =>
  deepFreeze({
    health: () => freezeSuccess(ports.health()),
    resolveSession: (headers: Parameters<GatewayPorts["resolveSession"]>[0]) =>
      freezeSuccess(ports.resolveSession(deepFreeze(headers))),
    createEpisodeJob: (
      input: Parameters<GatewayPorts["createEpisodeJob"]>[0]
    ) => freezeSuccess(ports.createEpisodeJob(deepFreeze(input))),
    listEpisodeJobs: (input: Parameters<GatewayPorts["listEpisodeJobs"]>[0]) =>
      freezeSuccess(ports.listEpisodeJobs(deepFreeze(input))),
    getEpisodeJob: (input: Parameters<GatewayPorts["getEpisodeJob"]>[0]) =>
      freezeSuccess(ports.getEpisodeJob(deepFreeze(input))),
    cancelEpisodeJob: (input: Parameters<GatewayPorts["cancelEpisodeJob"]>[0]) =>
      freezeSuccess(ports.cancelEpisodeJob(deepFreeze(input))),
    retryEpisodeJob: (input: Parameters<GatewayPorts["retryEpisodeJob"]>[0]) =>
      freezeSuccess(ports.retryEpisodeJob(deepFreeze(input))),
    streamEpisodeJobEvents: (
      input: Parameters<GatewayPorts["replayEpisodeJobEvents"]>[0]
    ) =>
      ports.replayEpisodeJobEvents(deepFreeze(input)).pipe(
        Effect.map(({ snapshot, events }) => {
          const toEvent = (job: typeof snapshot) =>
            deepFreeze({
              type: "STATE_SNAPSHOT" as const,
              timestamp: Date.parse(job.createdAt),
              snapshot: {
                jobId: job.id,
                status: job.status,
                attempt: job.attempt,
                maxAttempts: job.maxAttempts,
                adoptedArticles: [],
                ...(job.failure === undefined
                  ? {}
                  : {
                      failure: {
                        code: job.failure.code,
                        message: job.failure.message,
                      },
                    }),
                ...(job.episodeId === undefined
                  ? {}
                  : { episodeId: job.episodeId }),
              },
            })
          return Stream.fromIterable([
            {
              id: undefined,
              event: "STATE_SNAPSHOT" as const,
              data: toEvent(snapshot),
            },
            ...events.map(({ sequence, job }) => ({
              id: String(sequence),
              event: "STATE_SNAPSHOT" as const,
              data: toEvent(job),
            })),
          ])
        })
      ),
    listEpisodes: (input: Parameters<GatewayPorts["listEpisodes"]>[0]) =>
      freezeSuccess(ports.listEpisodes(deepFreeze(input))),
    getEpisode: (input: Parameters<GatewayPorts["getEpisode"]>[0]) =>
      freezeSuccess(ports.getEpisode(deepFreeze(input))),
    createAudioAccess: (
      input: Parameters<GatewayPorts["createAudioAccess"]>[0]
    ) => freezeSuccess(ports.createAudioAccess(deepFreeze(input))),
    addFeedSubscription: (
      input: Parameters<GatewayPorts["addFeedSubscription"]>[0]
    ) => freezeSuccess(ports.addFeedSubscription(deepFreeze(input))),
    listFeedSubscriptions: (
      headers: Parameters<GatewayPorts["listFeedSubscriptions"]>[0]
    ) => freezeSuccess(ports.listFeedSubscriptions(deepFreeze(headers))),
    deleteFeedSubscription: (
      input: Parameters<GatewayPorts["deleteFeedSubscription"]>[0]
    ) => freezeSuccess(ports.deleteFeedSubscription(deepFreeze(input))),
  })

export const makeGatewayHandlerLayer = (ports: GatewayPorts) => {
  const handlers = makeGatewayHandlers(ports)
  return Layer.mergeAll(
    HttpApiBuilder.group(gatewayApi, "system", (group) =>
      group.handle("health", handlers.health)
    ),
    HttpApiBuilder.group(gatewayApi, "session", (group) =>
      group.handle("resolveSession", ({ headers }) =>
        handlers.resolveSession(headers)
      )
    ),
    HttpApiBuilder.group(gatewayApi, "episodeJobs", (group) =>
      group
        .handle("createEpisodeJob", ({ headers, payload }) =>
          handlers.createEpisodeJob({ headers, payload })
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
            idempotencyKey:
              headers["idempotency-key"] ?? `retry:${params.jobId}`,
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
            afterSequence: Number.isSafeInteger(headerSequence) && headerSequence >= 0
              ? headerSequence
              : (query.lastEventId ?? 0),
          })
        })
    ),
    HttpApiBuilder.group(gatewayApi, "episodes", (group) =>
      group
        .handle("listEpisodes", ({ headers, query }) =>
          handlers.listEpisodes({
            headers,
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          })
        )
        .handle("getEpisode", ({ headers, params }) =>
          handlers.getEpisode({ headers, episodeId: params.episodeId })
        )
        .handle("createAudioAccess", ({ headers, params }) =>
          handlers.createAudioAccess({
            headers,
            episodeId: params.episodeId,
          })
        )
    ),
    HttpApiBuilder.group(gatewayApi, "feedSubscriptions", (group) =>
      group
        .handle("addFeedSubscription", ({ headers, payload }) =>
          handlers.addFeedSubscription({ headers, payload })
        )
        .handle("listFeedSubscriptions", ({ headers }) =>
          handlers.listFeedSubscriptions(headers)
        )
        .handle("deleteFeedSubscription", ({ headers, params }) =>
          handlers.deleteFeedSubscription({
            headers,
            subscriptionId: params.subscriptionId,
          })
        )
    )
  )
}
