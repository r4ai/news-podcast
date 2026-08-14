import { Effect, Layer, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  AudioAccessSchema,
  CreateEpisodeJobHeadersSchema,
  CreateEpisodeJobRequestSchema,
  EpisodeIdSchema,
  FeedSubscriptionSchema,
  JobReceiptSchema,
  SessionHeadersSchema,
} from "./contract.js"
import { makeGatewayHandlers, makeGatewayHandlerLayer } from "./handlers.js"
import type { GatewayPorts } from "./ports.js"

const health = { status: "ok" as const }
const anonymous = {
  authenticated: false as const,
  loginMethods: { development: false, google: true },
}
const jobReceipt = Schema.decodeUnknownSync(JobReceiptSchema)({
  id: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
  status: "queued",
  createdAt: "2026-08-12T00:00:00.000Z",
  attempt: 0,
  maxAttempts: 4,
})
const audioAccess = Schema.decodeUnknownSync(AudioAccessSchema)({
  url: "https://audio.example.test/episode.mp3?token=secret",
  expiresAt: "2026-08-12T00:05:00.000Z",
})
const subscription = Schema.decodeUnknownSync(FeedSubscriptionSchema)({
  id: "9aa2225d-07e7-4af4-a8e6-e4788f801a91",
  feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
  enabled: true,
  createdAt: "2026-08-12T00:00:00.000Z",
})
const unavailable = {
  type: "about:blank",
  title: "Unavailable",
  status: 503 as const,
  code: "unavailable",
}

const makePorts = (): GatewayPorts => ({
  health: () => Effect.succeed(health),
  resolveSession: () => Effect.succeed(anonymous),
  createEpisodeJob: () => Effect.succeed(jobReceipt),
  listEpisodeJobs: () =>
    Effect.succeed({ items: [], page: { hasMore: false } }),
  getEpisodeJob: () =>
    Effect.fail({
      status: 404,
      type: "about:blank",
      title: "Not found",
      code: "not_found",
    }),
  cancelEpisodeJob: () =>
    Effect.fail({
      status: 404,
      type: "about:blank",
      title: "Not found",
      code: "not_found",
    }),
  retryEpisodeJob: () => Effect.succeed(jobReceipt),
  replayEpisodeJobEvents: () =>
    Effect.fail({
      status: 404,
      type: "about:blank",
      title: "Not found",
      code: "not_found",
    }),
  listEpisodes: () => Effect.succeed({ items: [], page: { hasMore: false } }),
  getEpisode: () =>
    Effect.fail({
      status: 404,
      type: "about:blank",
      title: "Not found",
      code: "not_found",
    }),
  createAudioAccess: () => Effect.succeed(audioAccess),
  addFeedSubscription: () => Effect.succeed(subscription),
  listFeedSubscriptions: () =>
    Effect.succeed({ items: [subscription], page: { hasMore: false } }),
  listFeedSyncJobs: () =>
    Effect.succeed({ items: [], page: { hasMore: false } }),
  syncFeedSubscription: () => Effect.fail(unavailable),
  deleteFeedSubscription: () => Effect.void,
  updateFeedSubscription: () => Effect.fail(unavailable),
  listFeeds: () => Effect.succeed({ items: [], page: { hasMore: false } }),
  registerFeed: () => Effect.fail(unavailable),
  listArticles: () => Effect.succeed({ items: [], page: { hasMore: false } }),
  getArticle: () => Effect.fail(unavailable),
  getArticleMarkdown: () => Effect.fail(unavailable),
  patchArticle: () => Effect.fail(unavailable),
  bulkPatchArticles: () => Effect.succeed({ updated: 0 }),
  getArticleFacets: () =>
    Effect.succeed({
      states: { all: 0, unread: 0, saved: 0, later: 0 },
      feeds: [],
      aiPending: 0,
    }),
  archiveArticle: () => Effect.fail(unavailable),
  listArticleTags: () => Effect.fail(unavailable),
  setArticleTags: () => Effect.fail(unavailable),
  enrichArticle: () => Effect.fail(unavailable),
  getSettings: () => Effect.fail(unavailable),
  updateSettings: () => Effect.fail(unavailable),
  listTags: () => Effect.fail(unavailable),
  createTag: () => Effect.fail(unavailable),
  deleteTag: () => Effect.fail(unavailable),
  listTagSuggestions: () => Effect.fail(unavailable),
  promoteTagSuggestion: () => Effect.fail(unavailable),
  listReadingDictionary: () => Effect.fail(unavailable),
  createReadingDictionary: () => Effect.fail(unavailable),
  updateReadingDictionary: () => Effect.fail(unavailable),
  deleteReadingDictionary: () => Effect.fail(unavailable),
  getEnrichQueue: () => Effect.fail(unavailable),
  enrichReprocess: () => Effect.fail(unavailable),
  enrichResetDaily: () => Effect.fail(unavailable),
  listAgentInstances: () => Effect.fail(unavailable),
  getAgentRun: () => Effect.fail(unavailable),
  replayAgentRunEvents: () => Effect.fail(unavailable),
  listAgentMemories: () => Effect.fail(unavailable),
  createAgentMemory: () => Effect.fail(unavailable),
  approveAgentMemory: () => Effect.fail(unavailable),
  deleteAgentMemory: () => Effect.fail(unavailable),
})

describe("gateway port handlers", () => {
  it("injects every external port into a buildable Effect HttpApi layer", async () => {
    const context = await Effect.runPromise(
      Layer.build(makeGatewayHandlerLayer(makePorts())).pipe(Effect.scoped)
    )

    expect(context).toBeDefined()
  })

  it("delegates every personalization boundary", async () => {
    const handlers = makeGatewayHandlers(makePorts())
    const headers = Schema.decodeUnknownSync(SessionHeadersSchema)({})
    const id = "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
    const effects = [
      handlers.getSettings(headers),
      handlers.updateSettings({
        headers,
        payload: { interestProfile: { include: "", exclude: "" } },
      }),
      handlers.listTags(headers),
      handlers.createTag({ headers, payload: { name: "AI" } }),
      handlers.deleteTag({ headers, tagId: id }),
      handlers.listTagSuggestions(headers),
      handlers.promoteTagSuggestion({ headers, payload: { name: "AI" } }),
      handlers.listReadingDictionary(headers),
      handlers.createReadingDictionary({
        headers,
        payload: { surface: "NHK", reading: "エヌエイチケー" },
      }),
      handlers.updateReadingDictionary({
        headers,
        id,
        payload: { accentType: 0 },
      }),
      handlers.deleteReadingDictionary({ headers, id }),
      handlers.getEnrichQueue(headers),
      handlers.enrichReprocess(headers),
      handlers.enrichResetDaily(headers),
    ]

    const exits = await Effect.runPromise(
      Effect.forEach(effects, (effect) =>
        Effect.exit(effect as Effect.Effect<unknown, unknown, never>)
      )
    )
    expect(exits).toHaveLength(14)
  })

  it("deep-freezes every successful port result", async () => {
    const handlers = makeGatewayHandlers(makePorts())
    const headers = Schema.decodeUnknownSync(SessionHeadersSchema)({})
    const episodeId = Schema.decodeUnknownSync(EpisodeIdSchema)(
      "3c4d046c-b47b-4047-a562-66ac7e74e995"
    )
    const results = await Effect.runPromise(
      Effect.all([
        handlers.health(),
        handlers.resolveSession(headers),
        handlers.listEpisodes({ headers }),
        handlers.createAudioAccess({ headers, episodeId }),
        handlers.listFeedSubscriptions(headers),
      ])
    )

    for (const result of results) {
      expect(Object.isFrozen(result)).toBe(true)
    }
    expect(Object.isFrozen(results[1]?.loginMethods)).toBe(true)
    expect(Object.isFrozen(results[2]?.items)).toBe(true)
  })

  it("deep-freezes data before and after the external port", async () => {
    const createEpisodeJob = vi.fn((input) => {
      expect(Object.isFrozen(input)).toBe(true)
      expect(Object.isFrozen(input.headers)).toBe(true)
      expect(Object.isFrozen(input.payload)).toBe(true)
      expect(Object.isFrozen(input.payload.articleIds)).toBe(true)
      return makePorts().createEpisodeJob(input)
    })
    const handlers = makeGatewayHandlers({
      ...makePorts(),
      createEpisodeJob,
    })

    const receipt = await Effect.runPromise(
      handlers.createEpisodeJob({
        headers: Schema.decodeUnknownSync(CreateEpisodeJobHeadersSchema)({
          "idempotency-key": "request-1",
        }),
        payload: Schema.decodeUnknownSync(CreateEpisodeJobRequestSchema)({
          trigger: "manual",
          articleIds: ["5af55f2e-ff0b-475c-866a-f2cff48c101d"],
        }),
      })
    )

    expect(createEpisodeJob).toHaveBeenCalledOnce()
    expect(Object.isFrozen(handlers)).toBe(true)
    expect(Object.isFrozen(receipt)).toBe(true)
  })
})
