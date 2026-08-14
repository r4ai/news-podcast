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
    cancelEpisodeJob: (
      input: Parameters<GatewayPorts["cancelEpisodeJob"]>[0]
    ) => freezeSuccess(ports.cancelEpisodeJob(deepFreeze(input))),
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
    listFeedSyncJobs: (
      headers: Parameters<GatewayPorts["listFeedSyncJobs"]>[0]
    ) => freezeSuccess(ports.listFeedSyncJobs(deepFreeze(headers))),
    syncFeedSubscription: (
      input: Parameters<GatewayPorts["syncFeedSubscription"]>[0]
    ) => freezeSuccess(ports.syncFeedSubscription(deepFreeze(input))),
    deleteFeedSubscription: (
      input: Parameters<GatewayPorts["deleteFeedSubscription"]>[0]
    ) => freezeSuccess(ports.deleteFeedSubscription(deepFreeze(input))),
    updateFeedSubscription: (
      input: Parameters<GatewayPorts["updateFeedSubscription"]>[0]
    ) => freezeSuccess(ports.updateFeedSubscription(deepFreeze(input))),
    listFeeds: (input: Parameters<GatewayPorts["listFeeds"]>[0]) =>
      freezeSuccess(ports.listFeeds(deepFreeze(input))),
    registerFeed: (input: Parameters<GatewayPorts["registerFeed"]>[0]) =>
      freezeSuccess(ports.registerFeed(deepFreeze(input))),
    listArticles: (input: Parameters<GatewayPorts["listArticles"]>[0]) =>
      freezeSuccess(ports.listArticles(deepFreeze(input))),
    getArticle: (input: Parameters<GatewayPorts["getArticle"]>[0]) =>
      freezeSuccess(ports.getArticle(deepFreeze(input))),
    getArticleMarkdown: (
      input: Parameters<GatewayPorts["getArticleMarkdown"]>[0]
    ) => freezeSuccess(ports.getArticleMarkdown(deepFreeze(input))),
    patchArticle: (input: Parameters<GatewayPorts["patchArticle"]>[0]) =>
      freezeSuccess(ports.patchArticle(deepFreeze(input))),
    bulkPatchArticles: (
      input: Parameters<GatewayPorts["bulkPatchArticles"]>[0]
    ) => freezeSuccess(ports.bulkPatchArticles(deepFreeze(input))),
    getArticleFacets: (
      input: Parameters<GatewayPorts["getArticleFacets"]>[0]
    ) => freezeSuccess(ports.getArticleFacets(deepFreeze(input))),
    archiveArticle: (input: Parameters<GatewayPorts["archiveArticle"]>[0]) =>
      freezeSuccess(ports.archiveArticle(deepFreeze(input))),
    listArticleTags: (input: Parameters<GatewayPorts["listArticleTags"]>[0]) =>
      freezeSuccess(ports.listArticleTags(deepFreeze(input))),
    setArticleTags: (input: Parameters<GatewayPorts["setArticleTags"]>[0]) =>
      freezeSuccess(ports.setArticleTags(deepFreeze(input))),
    enrichArticle: (input: Parameters<GatewayPorts["enrichArticle"]>[0]) =>
      freezeSuccess(ports.enrichArticle(deepFreeze(input))),
    getSettings: (headers: Parameters<GatewayPorts["getSettings"]>[0]) =>
      freezeSuccess(ports.getSettings(deepFreeze(headers))),
    updateSettings: (input: Parameters<GatewayPorts["updateSettings"]>[0]) =>
      freezeSuccess(ports.updateSettings(deepFreeze(input))),
    listTags: (headers: Parameters<GatewayPorts["listTags"]>[0]) =>
      freezeSuccess(ports.listTags(deepFreeze(headers))),
    createTag: (input: Parameters<GatewayPorts["createTag"]>[0]) =>
      freezeSuccess(ports.createTag(deepFreeze(input))),
    deleteTag: (input: Parameters<GatewayPorts["deleteTag"]>[0]) =>
      freezeSuccess(ports.deleteTag(deepFreeze(input))),
    listTagSuggestions: (
      headers: Parameters<GatewayPorts["listTagSuggestions"]>[0]
    ) => freezeSuccess(ports.listTagSuggestions(deepFreeze(headers))),
    promoteTagSuggestion: (
      input: Parameters<GatewayPorts["promoteTagSuggestion"]>[0]
    ) => freezeSuccess(ports.promoteTagSuggestion(deepFreeze(input))),
    listReadingDictionary: (
      headers: Parameters<GatewayPorts["listReadingDictionary"]>[0]
    ) => freezeSuccess(ports.listReadingDictionary(deepFreeze(headers))),
    createReadingDictionary: (
      input: Parameters<GatewayPorts["createReadingDictionary"]>[0]
    ) => freezeSuccess(ports.createReadingDictionary(deepFreeze(input))),
    updateReadingDictionary: (
      input: Parameters<GatewayPorts["updateReadingDictionary"]>[0]
    ) => freezeSuccess(ports.updateReadingDictionary(deepFreeze(input))),
    deleteReadingDictionary: (
      input: Parameters<GatewayPorts["deleteReadingDictionary"]>[0]
    ) => freezeSuccess(ports.deleteReadingDictionary(deepFreeze(input))),
    getEnrichQueue: (headers: Parameters<GatewayPorts["getEnrichQueue"]>[0]) =>
      freezeSuccess(ports.getEnrichQueue(deepFreeze(headers))),
    enrichReprocess: (
      headers: Parameters<GatewayPorts["enrichReprocess"]>[0]
    ) => freezeSuccess(ports.enrichReprocess(deepFreeze(headers))),
    enrichResetDaily: (
      headers: Parameters<GatewayPorts["enrichResetDaily"]>[0]
    ) => freezeSuccess(ports.enrichResetDaily(deepFreeze(headers))),
    listAgentInstances: (
      headers: Parameters<GatewayPorts["listAgentInstances"]>[0]
    ) => freezeSuccess(ports.listAgentInstances(deepFreeze(headers))),
    getAgentRun: (input: Parameters<GatewayPorts["getAgentRun"]>[0]) =>
      freezeSuccess(ports.getAgentRun(deepFreeze(input))),
    streamAgentRunEvents: (
      input: Parameters<GatewayPorts["replayAgentRunEvents"]>[0]
    ) =>
      ports.replayAgentRunEvents(deepFreeze(input)).pipe(
        Effect.map((events) =>
          Stream.fromIterable(
            events.map((event) => ({
              id: String(event.sequence),
              event: event.type,
              data: event,
            }))
          )
        )
      ),
    listAgentMemories: (
      input: Parameters<GatewayPorts["listAgentMemories"]>[0]
    ) => freezeSuccess(ports.listAgentMemories(deepFreeze(input))),
    createAgentMemory: (
      input: Parameters<GatewayPorts["createAgentMemory"]>[0]
    ) => freezeSuccess(ports.createAgentMemory(deepFreeze(input))),
    approveAgentMemory: (
      input: Parameters<GatewayPorts["approveAgentMemory"]>[0]
    ) => freezeSuccess(ports.approveAgentMemory(deepFreeze(input))),
    deleteAgentMemory: (
      input: Parameters<GatewayPorts["deleteAgentMemory"]>[0]
    ) => freezeSuccess(ports.deleteAgentMemory(deepFreeze(input))),
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
              ...(headers.cookie === undefined
                ? {}
                : { cookie: headers.cookie }),
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
        .handle("listFeedSyncJobs", ({ headers }) =>
          handlers.listFeedSyncJobs(headers)
        )
        .handle("syncFeedSubscription", ({ headers, params }) =>
          handlers.syncFeedSubscription({
            headers,
            subscriptionId: params.subscriptionId,
          })
        )
        .handle("deleteFeedSubscription", ({ headers, params }) =>
          handlers.deleteFeedSubscription({
            headers,
            subscriptionId: params.subscriptionId,
          })
        )
        .handle("updateFeedSubscription", ({ headers, params, payload }) =>
          handlers.updateFeedSubscription({
            headers,
            subscriptionId: params.subscriptionId,
            payload,
          })
        )
    ),
    HttpApiBuilder.group(gatewayApi, "feeds", (group) =>
      group
        .handle("listFeeds", ({ headers, query }) =>
          handlers.listFeeds({
            headers,
            ...(query.q === undefined ? {} : { q: query.q }),
          })
        )
        .handle("registerFeed", ({ headers, payload }) =>
          handlers.registerFeed({ headers, payload })
        )
    ),
    HttpApiBuilder.group(gatewayApi, "articles", (group) =>
      group
        .handle("listArticles", ({ headers, query }) =>
          handlers.listArticles({
            headers,
            query: {
              ...(query.limit === undefined ? {} : { limit: query.limit }),
              ...(query.state === undefined ? {} : { state: query.state }),
              ...(query.includeHidden === undefined
                ? {}
                : { includeHidden: query.includeHidden }),
              ...(query.feedIds === undefined
                ? {}
                : { feedIds: query.feedIds }),
              ...(query.q === undefined ? {} : { q: query.q }),
              ...(query.sort === "newest" || query.sort === "oldest"
                ? { sort: query.sort }
                : {}),
              ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            },
          })
        )
        .handle("getArticleFacets", ({ headers, query }) =>
          handlers.getArticleFacets({
            headers,
            query: {
              ...(query.includeHidden === undefined
                ? {}
                : { includeHidden: query.includeHidden }),
              ...(query.feedIds === undefined
                ? {}
                : { feedIds: query.feedIds }),
              ...(query.q === undefined ? {} : { q: query.q }),
            },
          })
        )
        .handle("getArticle", ({ headers, params }) =>
          handlers.getArticle({ headers, articleId: params.articleId })
        )
        .handle("getArticleMarkdown", ({ headers, params }) =>
          handlers.getArticleMarkdown({
            headers,
            articleId: params.articleId,
          })
        )
        .handle("patchArticle", ({ headers, params, payload }) =>
          handlers.patchArticle({
            headers,
            articleId: params.articleId,
            payload,
          })
        )
        .handle("bulkPatchArticles", ({ headers, payload }) =>
          handlers.bulkPatchArticles({ headers, payload })
        )
        .handle("archiveArticle", ({ headers, params }) =>
          handlers.archiveArticle({ headers, articleId: params.articleId })
        )
        .handle("listArticleTags", ({ headers, params }) =>
          handlers.listArticleTags({ headers, articleId: params.articleId })
        )
        .handle("setArticleTags", ({ headers, params, payload }) =>
          handlers.setArticleTags({
            headers,
            articleId: params.articleId,
            payload,
          })
        )
        .handle("enrichArticle", ({ headers, params }) =>
          handlers.enrichArticle({ headers, articleId: params.articleId })
        )
    ),
    HttpApiBuilder.group(gatewayApi, "personalization", (group) =>
      group
        .handle("getSettings", ({ headers }) => handlers.getSettings(headers))
        .handle("updateSettings", ({ headers, payload }) =>
          handlers.updateSettings({ headers, payload })
        )
        .handle("listTags", ({ headers }) => handlers.listTags(headers))
        .handle("createTag", ({ headers, payload }) =>
          handlers.createTag({ headers, payload })
        )
        .handle("deleteTag", ({ headers, params }) =>
          handlers.deleteTag({ headers, tagId: params.tagId })
        )
        .handle("listTagSuggestions", ({ headers }) =>
          handlers.listTagSuggestions(headers)
        )
        .handle("promoteTagSuggestion", ({ headers, payload }) =>
          handlers.promoteTagSuggestion({ headers, payload })
        )
        .handle("listReadingDictionary", ({ headers }) =>
          handlers.listReadingDictionary(headers)
        )
        .handle("createReadingDictionary", ({ headers, payload }) =>
          handlers.createReadingDictionary({ headers, payload })
        )
        .handle("updateReadingDictionary", ({ headers, params, payload }) =>
          handlers.updateReadingDictionary({ headers, id: params.id, payload })
        )
        .handle("deleteReadingDictionary", ({ headers, params }) =>
          handlers.deleteReadingDictionary({ headers, id: params.id })
        )
        .handle("getEnrichQueue", ({ headers }) =>
          handlers.getEnrichQueue(headers)
        )
        .handle("enrichReprocess", ({ headers }) =>
          handlers.enrichReprocess(headers)
        )
        .handle("enrichResetDaily", ({ headers }) =>
          handlers.enrichResetDaily(headers)
        )
    ),
    HttpApiBuilder.group(gatewayApi, "agents", (group) =>
      group
        .handle("listAgentInstances", ({ headers }) =>
          handlers.listAgentInstances(headers)
        )
        .handle("getAgentRun", ({ headers, params }) =>
          handlers.getAgentRun({ headers, runId: params.runId })
        )
        .handle("streamAgentRunEvents", ({ headers, params, query }) => {
          const headerSequence = Number(headers["last-event-id"])
          return handlers.streamAgentRunEvents({
            headers: {
              ...(headers.authorization === undefined
                ? {}
                : { authorization: headers.authorization }),
              ...(headers.cookie === undefined
                ? {}
                : { cookie: headers.cookie }),
              ...(headers.traceparent === undefined
                ? {}
                : { traceparent: headers.traceparent }),
            },
            runId: params.runId,
            afterSequence:
              Number.isSafeInteger(headerSequence) && headerSequence >= 0
                ? headerSequence
                : (query.lastEventId ?? 0),
          })
        })
        .handle("listAgentMemories", ({ headers, params }) =>
          handlers.listAgentMemories({
            headers,
            agentInstanceId: params.agentInstanceId,
          })
        )
        .handle("createAgentMemory", ({ headers, params, payload }) =>
          handlers.createAgentMemory({
            headers,
            agentInstanceId: params.agentInstanceId,
            payload,
          })
        )
        .handle("approveAgentMemory", ({ headers, params }) =>
          handlers.approveAgentMemory({
            headers,
            agentInstanceId: params.agentInstanceId,
            memoryId: params.memoryId,
          })
        )
        .handle("deleteAgentMemory", ({ headers, params }) =>
          handlers.deleteAgentMemory({
            headers,
            agentInstanceId: params.agentInstanceId,
            memoryId: params.memoryId,
          })
        )
    )
  )
}
