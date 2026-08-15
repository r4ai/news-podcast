import { Effect, Layer, Schema, Tracer } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  AgentRunEventSchema,
  ArticleSchema,
  EpisodeIdSchema,
  EpisodeJobSchema,
  EpisodeSchema,
  FeedSubscriptionSchema,
  FeedPageSchema,
  RegisteredFeedSchema,
  UpdatedFeedSubscriptionSchema,
  JobIdSchema,
  JobReceiptSchema,
} from "../contract.js"
import type { GatewayPorts } from "../application/ports.js"
import { makeGatewayWebHandler } from "./http.js"

const unavailable = {
  type: "about:blank",
  title: "Unavailable",
  status: 503 as const,
  code: "unavailable",
}

const ports: GatewayPorts = {
  health: () => Effect.succeed({ status: "ok" }),
  resolveSession: () =>
    Effect.succeed({
      authenticated: false,
      loginMethods: { development: true, google: false },
    }),
  createEpisodeJob: () => Effect.fail(unavailable),
  listEpisodeJobs: () => Effect.fail(unavailable),
  getEpisodeJob: () => Effect.fail(unavailable),
  cancelEpisodeJob: () => Effect.fail(unavailable),
  retryEpisodeJob: () => Effect.fail(unavailable),
  replayEpisodeJobEvents: () => Effect.fail(unavailable),
  listEpisodes: () => Effect.fail(unavailable),
  getEpisode: () => Effect.fail(unavailable),
  createAudioAccess: () => Effect.fail(unavailable),
  addFeedSubscription: () => Effect.fail(unavailable),
  listFeedSubscriptions: () => Effect.fail(unavailable),
  listFeedSyncJobs: () => Effect.fail(unavailable),
  syncFeedSubscription: () => Effect.fail(unavailable),
  deleteFeedSubscription: () => Effect.fail(unavailable),
  updateFeedSubscription: () => Effect.fail(unavailable),
  listFeeds: () => Effect.fail(unavailable),
  registerFeed: () => Effect.fail(unavailable),
  listArticles: () => Effect.fail(unavailable),
  getArticle: () => Effect.fail(unavailable),
  getArticleMarkdown: () => Effect.fail(unavailable),
  patchArticle: () => Effect.fail(unavailable),
  bulkPatchArticles: () => Effect.fail(unavailable),
  getArticleFacets: () => Effect.fail(unavailable),
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
}

describe("Gateway HTTP runtime", () => {
  it("serves feed catalog and owner article workflows", async () => {
    const subscription = Schema.decodeUnknownSync(FeedSubscriptionSchema)({
      id: "9aa2225d-07e7-4af4-a8e6-e4788f801a91",
      feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
      enabled: true,
      createdAt: "2026-08-12T00:00:00.000Z",
    })
    const article = Schema.decodeUnknownSync(ArticleSchema)({
      id: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
      feedId: subscription.feedId,
      sourceName: "example.com",
      title: "Stable article",
      url: "https://example.com/article",
      discoveredAt: "2026-08-12T00:00:00.000Z",
      archiveStatus: "succeeded",
      snapshotId: "6518412b-ce2f-4641-9f2c-a02dd515bc31",
      read: false,
      saved: false,
      readLater: false,
      hidden: false,
    })
    const runtime = makeGatewayWebHandler({
      ...ports,
      listFeeds: () =>
        Effect.succeed(
          Schema.decodeUnknownSync(FeedPageSchema)({
            items: [
              {
                id: subscription.feedId,
                name: "feeds.example.com",
                siteUrl: "https://feeds.example.com/",
                feedUrl: "https://feeds.example.com/news.xml",
              },
            ],
            page: { hasMore: false },
          })
        ),
      registerFeed: () =>
        Effect.succeed(
          Schema.decodeUnknownSync(RegisteredFeedSchema)({
            feed: {
              id: subscription.feedId,
              name: "feeds.example.com",
              siteUrl: "https://feeds.example.com/",
              feedUrl: "https://feeds.example.com/news.xml",
            },
            subscription,
          })
        ),
      updateFeedSubscription: () =>
        Effect.succeed(
          Schema.decodeUnknownSync(UpdatedFeedSubscriptionSchema)({
            ...subscription,
            enabled: false,
          })
        ),
      listArticles: () =>
        Effect.succeed({ items: [article], page: { hasMore: false } }),
      getArticle: () => Effect.succeed(article),
      getArticleMarkdown: () => Effect.succeed({ markdown: "# Article" }),
      patchArticle: () => Effect.succeed({ ...article, saved: true }),
      bulkPatchArticles: () => Effect.succeed({ updated: 1 }),
      getArticleFacets: () =>
        Effect.succeed({
          states: { all: 1, unread: 1, saved: 0, later: 0 },
          feeds: [
            { feedId: subscription.feedId, name: "example.com", count: 1 },
          ],
          aiPending: 0,
        }),
      archiveArticle: () => Effect.succeed({ status: "already_archived" }),
      listArticleTags: () => Effect.succeed({ items: [] }),
      setArticleTags: () => Effect.succeed({ items: [] }),
      enrichArticle: () => Effect.succeed({ enqueued: 1 }),
    })
    const requests = [
      new Request("http://gateway.test/v1/feeds?q=news"),
      new Request("http://gateway.test/v1/feeds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedUrl: "https://feeds.example.com/news.xml" }),
      }),
      new Request(
        `http://gateway.test/v1/me/feed-subscriptions/${subscription.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        }
      ),
      new Request(
        "http://gateway.test/v1/me/articles?limit=20&state=all&includeHidden=false&sort=newest"
      ),
      new Request("http://gateway.test/v1/me/articles/facets?q=news"),
      new Request(`http://gateway.test/v1/me/articles/${article.id}`),
      new Request(`http://gateway.test/v1/me/articles/${article.id}/markdown`),
      new Request(`http://gateway.test/v1/me/articles/${article.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ saved: true }),
      }),
      new Request("http://gateway.test/v1/me/articles/bulk-state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read: true }),
      }),
      new Request(`http://gateway.test/v1/me/articles/${article.id}/archive`, {
        method: "POST",
      }),
      new Request(`http://gateway.test/v1/me/articles/${article.id}/tags`),
      new Request(`http://gateway.test/v1/me/articles/${article.id}/tags`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagIds: [] }),
      }),
      new Request(`http://gateway.test/v1/me/articles/${article.id}/enrich`, {
        method: "POST",
      }),
    ]
    try {
      const responses = await Promise.all(
        requests.map((request) => runtime.handler(request))
      )
      expect(responses.map(({ status }) => status)).toEqual([
        200, 201, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
      ])
    } finally {
      await runtime.dispose()
    }
  })

  it("serves job control, episode detail, and bounded replay routes", async () => {
    const job = Schema.decodeUnknownSync(EpisodeJobSchema)({
      id: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
      status: "queued",
      createdAt: "2026-08-12T00:00:00.000Z",
      attempt: 0,
      maxAttempts: 4,
    })
    const receipt = Schema.decodeUnknownSync(JobReceiptSchema)(job)
    const episode = Schema.decodeUnknownSync(EpisodeSchema)({
      id: "3c4d046c-b47b-4047-a562-66ac7e74e995",
      title: "Daily news",
      script: "Immutable script",
      sources: [{ url: "https://example.com/story", title: "Story" }],
      createdAt: "2026-08-12T00:00:00.000Z",
    })
    const replayEpisodeJobEvents = vi.fn(() =>
      Effect.succeed({
        snapshot: job,
        events: [{ sequence: 42, job }],
      })
    )
    const runtime = makeGatewayWebHandler({
      ...ports,
      listEpisodeJobs: () =>
        Effect.succeed({ items: [job], page: { hasMore: false } }),
      getEpisodeJob: () => Effect.succeed(job),
      cancelEpisodeJob: () => Effect.succeed(job),
      retryEpisodeJob: () => Effect.succeed(receipt),
      replayEpisodeJobEvents,
      getEpisode: () => Effect.succeed(episode),
    })
    const jobId = Schema.decodeUnknownSync(JobIdSchema)(job.id)
    const episodeId = Schema.decodeUnknownSync(EpisodeIdSchema)(episode.id)

    try {
      const responses = await Promise.all([
        runtime.handler(
          new Request("http://gateway.test/v1/episode-jobs?limit=20")
        ),
        runtime.handler(
          new Request(`http://gateway.test/v1/episode-jobs/${jobId}`)
        ),
        runtime.handler(
          new Request(`http://gateway.test/v1/episode-jobs/${jobId}/cancel`, {
            method: "POST",
          })
        ),
        runtime.handler(
          new Request(`http://gateway.test/v1/episode-jobs/${jobId}/retry`, {
            method: "POST",
          })
        ),
        runtime.handler(
          new Request(`http://gateway.test/v1/episodes/${episodeId}`)
        ),
      ])
      const replayed = await runtime.handler(
        new Request(
          `http://gateway.test/v1/episode-jobs/${jobId}/events?lastEventId=7`,
          {
            headers: { "Last-Event-ID": "41" },
          }
        )
      )
      const queryResumed = await runtime.handler(
        new Request(
          `http://gateway.test/v1/episode-jobs/${jobId}/events?lastEventId=7`
        )
      )

      expect(responses.map(({ status }) => status)).toEqual([
        200, 200, 200, 202, 200,
      ])
      expect(await responses[4]!.json()).toEqual(episode)
      expect(replayed.headers.get("content-type")).toContain(
        "text/event-stream"
      )
      const stream = await replayed.text()
      expect(stream).toContain("event: STATE_SNAPSHOT")
      expect(stream).toContain("id: 42")
      expect(await queryResumed.text()).toContain("event: STATE_SNAPSHOT")
      expect(replayEpisodeJobEvents).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ jobId, afterSequence: 41 })
      )
      expect(replayEpisodeJobEvents).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ jobId, afterSequence: 7 })
      )
    } finally {
      await runtime.dispose()
    }
  })

  it("runs request port effects with the supplied telemetry tracer", async () => {
    const spans: string[] = []
    const tracer = Tracer.make({
      span: (options) => {
        spans.push(options.name)
        return new Tracer.NativeSpan(options)
      },
    })
    const telemetry = Layer.succeed(Tracer.Tracer)(tracer)
    const runtime = makeGatewayWebHandler(
      {
        ...ports,
        health: () =>
          Effect.succeed({ status: "ok" as const }).pipe(
            Effect.withSpan("gateway.test.request")
          ),
      },
      telemetry
    )

    try {
      const response = await runtime.handler(
        new Request("http://gateway.test/health")
      )

      expect(response.status).toBe(200)
      expect(spans).toContain("gateway.test.request")
    } finally {
      await runtime.dispose()
    }
  })

  it("serves the Effect HttpApi contract through a Fetch handler", async () => {
    const runtime = makeGatewayWebHandler(ports)

    try {
      const response = await runtime.handler(
        new Request("http://gateway.test/health")
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "ok" })
    } finally {
      await runtime.dispose()
    }
  })

  it("serves the owner-scoped subscription lifecycle", async () => {
    const subscription = Schema.decodeUnknownSync(FeedSubscriptionSchema)({
      id: "9aa2225d-07e7-4af4-a8e6-e4788f801a91",
      feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
      enabled: true,
      createdAt: "2026-08-12T00:00:00.000Z",
    })
    const addFeedSubscription = vi.fn(() => Effect.succeed(subscription))
    const listFeedSubscriptions = vi.fn(() =>
      Effect.succeed({
        items: [subscription],
        page: { hasMore: false as const },
      })
    )
    const deleteFeedSubscription = vi.fn(() => Effect.void)
    const runtime = makeGatewayWebHandler({
      ...ports,
      addFeedSubscription,
      listFeedSubscriptions,
      deleteFeedSubscription,
    })

    try {
      const created = await runtime.handler(
        new Request("http://gateway.test/v1/me/feed-subscriptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            feedUrl: "https://feeds.example.com/news.xml",
          }),
        })
      )
      const listed = await runtime.handler(
        new Request("http://gateway.test/v1/me/feed-subscriptions")
      )
      const deleted = await runtime.handler(
        new Request(
          `http://gateway.test/v1/me/feed-subscriptions/${subscription.id}`,
          { method: "DELETE" }
        )
      )

      expect(created.status).toBe(201)
      expect(await created.json()).toEqual(subscription)
      expect(listed.status).toBe(200)
      expect(await listed.json()).toEqual({
        items: [subscription],
        page: { hasMore: false },
      })
      expect(deleted.status).toBe(204)
      expect(await deleted.text()).toBe("")
      expect(addFeedSubscription).toHaveBeenCalledOnce()
      expect(listFeedSubscriptions).toHaveBeenCalledOnce()
      expect(deleteFeedSubscription).toHaveBeenCalledOnce()
    } finally {
      await runtime.dispose()
    }
  })

  it("exposes every personalization route through the public runtime", async () => {
    const runtime = makeGatewayWebHandler(ports)
    const id = "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
    const json = (method: string, body: unknown) => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const requests = [
      new Request("http://gateway.test/v1/me/settings"),
      new Request(
        "http://gateway.test/v1/me/settings",
        json("PATCH", { interestProfile: { include: "", exclude: "" } })
      ),
      new Request("http://gateway.test/v1/me/tags"),
      new Request(
        "http://gateway.test/v1/me/tags",
        json("POST", { name: "AI" })
      ),
      new Request(`http://gateway.test/v1/me/tags/${id}`, { method: "DELETE" }),
      new Request("http://gateway.test/v1/me/tag-suggestions"),
      new Request(
        "http://gateway.test/v1/me/tag-suggestions/promote",
        json("POST", { name: "AI" })
      ),
      new Request("http://gateway.test/v1/me/reading-dictionary"),
      new Request(
        "http://gateway.test/v1/me/reading-dictionary",
        json("POST", { surface: "NHK", reading: "エヌエイチケー" })
      ),
      new Request(
        `http://gateway.test/v1/me/reading-dictionary/${id}`,
        json("PUT", { accentType: 0 })
      ),
      new Request(`http://gateway.test/v1/me/reading-dictionary/${id}`, {
        method: "DELETE",
      }),
      new Request("http://gateway.test/v1/me/enrich/queue"),
      new Request("http://gateway.test/v1/me/enrich/reprocess", {
        method: "POST",
      }),
      new Request("http://gateway.test/v1/me/enrich/reset-daily", {
        method: "POST",
      }),
    ]

    try {
      const responses = []
      for (const request of requests)
        responses.push(await runtime.handler(request))
      expect(responses.map(({ status }) => status)).toEqual(Array(14).fill(503))
    } finally {
      await runtime.dispose()
    }
  })

  it("serves bounded Agent event replay with header and query resumption", async () => {
    const runId = "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80"
    const replayAgentRunEvents = vi.fn(() =>
      Effect.succeed([
        Schema.decodeUnknownSync(AgentRunEventSchema)({
          schemaVersion: 1 as const,
          runId,
          sequence: 8,
          type: "run.updated",
          occurredAt: "2026-08-12T00:00:00.000Z",
          payload: { status: "running" },
        }),
      ])
    )
    const runtime = makeGatewayWebHandler({
      ...ports,
      replayAgentRunEvents,
    })

    try {
      const resumedByHeader = await runtime.handler(
        new Request(
          `http://gateway.test/v1/me/agent-runs/${runId}/events?lastEventId=3`,
          {
            headers: {
              authorization: "Bearer opaque",
              cookie: "session=opaque",
              traceparent:
                "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
              "last-event-id": "7",
            },
          }
        )
      )
      const resumedByQuery = await runtime.handler(
        new Request(
          `http://gateway.test/v1/me/agent-runs/${runId}/events?lastEventId=3`
        )
      )

      expect(resumedByHeader.status).toBe(200)
      expect(await resumedByHeader.text()).toContain("event: run.updated")
      expect(await resumedByQuery.text()).toContain("id: 8")
      expect(replayAgentRunEvents).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ runId, afterSequence: 7 })
      )
      expect(replayAgentRunEvents).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ runId, afterSequence: 3 })
      )
    } finally {
      await runtime.dispose()
    }
  })

  it("rejects malformed requests before invoking a port", async () => {
    let calls = 0
    const runtime = makeGatewayWebHandler({
      ...ports,
      createEpisodeJob: () => {
        calls += 1
        return Effect.fail(unavailable)
      },
    })

    try {
      const response = await runtime.handler(
        new Request("http://gateway.test/v1/episode-jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trigger: "manual" }),
        })
      )

      expect(response.status).toBe(400)
      expect(calls).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })
})
