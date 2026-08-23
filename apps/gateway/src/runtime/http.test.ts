import { createHash } from "node:crypto"
import { Effect, Layer, Schema, Tracer } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  AudioAccessSchema,
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
  type: "about:blank" as const,
  title: "Upstream unavailable" as const,
  status: 503 as const,
  code: "upstream_unavailable" as const,
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
  getArticleSnapshot: () => Effect.fail(unavailable),
  getArticleMarkdown: () => Effect.fail(unavailable),
  getArticleSnapshotMarkdown: () => Effect.fail(unavailable),
  createArticleReplayAccess: () => Effect.fail(unavailable),
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
}

describe("Gateway HTTP runtime", () => {
  it("serves the generated OpenAPI document and Scalar reference", async () => {
    const runtime = makeGatewayWebHandler(ports)

    try {
      const [document, reference] = await Promise.all([
        runtime.handler(new Request("http://gateway.test/openapi.json")),
        runtime.handler(new Request("http://gateway.test/docs")),
      ])

      expect(document.status).toBe(200)
      expect(document.headers.get("content-type")).toContain("application/json")
      expect(document.headers.get("cache-control")).toBe("no-store")
      expect(await document.json()).toMatchObject({
        openapi: "3.1.0",
        info: { title: "RSS News Podcast API" },
      })

      expect(reference.status).toBe(200)
      expect(reference.headers.get("content-type")).toContain("text/html")
      expect(reference.headers.get("cache-control")).toBe("no-store")
      const html = await reference.text()
      expect(html).toContain("News Podcast API Reference")
      expect(html).toContain("/openapi.json")
      expect(html).toContain("@scalar/api-reference")
    } finally {
      await runtime.dispose()
    }
  })

  it("returns 403 without invoking reset storage when the server policy rejects it", async () => {
    const runtime = makeGatewayWebHandler({
      ...ports,
      enrichResetDaily: () =>
        Effect.fail({
          type: "about:blank" as const,
          title: "Operation forbidden" as const,
          status: 403 as const,
          code: "operation_forbidden" as const,
        }),
    })

    try {
      const response = await runtime.handler(
        new Request("http://gateway.test/v1/me/enrich/reset-daily", {
          method: "POST",
        })
      )

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        type: "about:blank",
        title: "Operation forbidden",
        status: 403,
        code: "operation_forbidden",
      })
    } finally {
      await runtime.dispose()
    }
  })

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
      getArticleSnapshot: () => Effect.succeed(article),
      getArticleMarkdown: () => Effect.succeed({ markdown: "# Article" }),
      getArticleSnapshotMarkdown: () =>
        Effect.succeed({ markdown: "# Article snapshot" }),
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
      new Request(
        `http://gateway.test/v1/me/articles/${article.id}/snapshots/${article.snapshotId}`
      ),
      new Request(
        `http://gateway.test/v1/me/articles/${article.id}/snapshots/${article.snapshotId}/markdown`
      ),
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
        200, 201, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200,
        200,
      ])
    } finally {
      await runtime.dispose()
    }
  })

  it("serves job control, episode detail, and terminal replay routes", async () => {
    const job = Schema.decodeUnknownSync(EpisodeJobSchema)({
      id: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
      status: "succeeded",
      trigger: "manual",
      createdAt: "2026-08-12T00:00:00.000Z",
      attempt: 1,
      maxAttempts: 4,
      finishedAt: "2026-08-12T00:01:00.000Z",
      episodeId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
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
        events: [
          {
            sequence: 42,
            event: {
              type: "STATE_SNAPSHOT",
              timestamp: 1,
              snapshot: {
                jobId: job.id,
                status: "succeeded",
                attempt: 1,
                maxAttempts: 4,
                selectionMode: "automatic",
                selectedArticles: [],
                episodeId: episode.id,
              },
            },
          },
        ],
      })
    )
    const retryEpisodeJob = vi.fn<GatewayPorts["retryEpisodeJob"]>((_input) =>
      Effect.succeed(receipt)
    )
    const runtime = makeGatewayWebHandler({
      ...ports,
      listEpisodeJobs: () =>
        Effect.succeed({ items: [job], page: { hasMore: false } }),
      getEpisodeJob: () => Effect.succeed(job),
      cancelEpisodeJob: () => Effect.succeed(job),
      retryEpisodeJob,
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
      expect(stream).not.toContain("event:")
      expect(stream).toContain("id: 42")
      expect(await queryResumed.text()).not.toContain("event:")
      expect(retryEpisodeJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId,
          idempotencyKey: expect.stringMatching(`^retry:${jobId}:`),
        })
      )
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

  it("issues a fresh retry key per headerless action and preserves explicit keys", async () => {
    const job = Schema.decodeUnknownSync(EpisodeJobSchema)({
      id: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
      status: "failed",
      trigger: "manual",
      createdAt: "2026-08-12T00:00:00.000Z",
      attempt: 1,
      maxAttempts: 4,
      finishedAt: "2026-08-12T00:01:00.000Z",
      error: { code: "provider-timeout", retryable: true },
    })
    const receipt = Schema.decodeUnknownSync(JobReceiptSchema)(job)
    const retryEpisodeJob = vi.fn<GatewayPorts["retryEpisodeJob"]>((_input) =>
      Effect.succeed(receipt)
    )
    const runtime = makeGatewayWebHandler({ ...ports, retryEpisodeJob })
    const url = `http://gateway.test/v1/episode-jobs/${job.id}/retry`

    try {
      await runtime.handler(new Request(url, { method: "POST" }))
      await runtime.handler(new Request(url, { method: "POST" }))
      await runtime.handler(
        new Request(url, {
          method: "POST",
          headers: { "Idempotency-Key": "caller-retry-1" },
        })
      )

      const keys = retryEpisodeJob.mock.calls.map(
        ([input]) => input.idempotencyKey
      )
      expect(keys[0]).not.toBe(keys[1])
      expect(keys[2]).toBe("caller-retry-1")
    } finally {
      await runtime.dispose()
    }
  })

  it("streams owned audio through the gateway without exposing its internal URL", async () => {
    const episodeId = Schema.decodeUnknownSync(EpisodeIdSchema)(
      "3c4d046c-b47b-4047-a562-66ac7e74e995"
    )
    const access = Schema.decodeUnknownSync(AudioAccessSchema)({
      url: "http://seaweedfs:8333/news-podcast/private.wav?signature=secret",
      expiresAt: "2026-08-12T00:05:00.000Z",
    })
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(Uint8Array.from([82, 73, 70, 70]), {
          status: 206,
          headers: {
            "accept-ranges": "bytes",
            "content-length": "4",
            "content-range": "bytes 0-3/44",
            "content-type": "audio/wav",
            "x-internal-object-url": access.url,
          },
        })
      )
    )
    const createAudioAccess = vi.fn(() => Effect.succeed(access))
    const runtime = makeGatewayWebHandler(
      { ...ports, createAudioAccess },
      Layer.empty,
      { fetcher }
    )

    try {
      const response = await runtime.handler(
        new Request(`http://gateway.test/v1/episodes/${episodeId}/audio`, {
          headers: { range: "bytes=0-3" },
        })
      )

      expect(response.status).toBe(206)
      expect(response.headers.get("content-type")).toBe("audio/wav")
      expect(response.headers.get("content-range")).toBe("bytes 0-3/44")
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("x-internal-object-url")).toBeNull()
      expect(await response.arrayBuffer()).toEqual(
        Uint8Array.from([82, 73, 70, 70]).buffer
      )
      expect(fetcher).toHaveBeenCalledWith(access.url, {
        headers: { range: "bytes=0-3" },
      })
      expect(createAudioAccess).toHaveBeenCalledOnce()
    } finally {
      await runtime.dispose()
    }
  })

  it("rejects unsupported multi-range audio requests before contacting storage", async () => {
    const access = Schema.decodeUnknownSync(AudioAccessSchema)({
      url: "http://seaweedfs:8333/news-podcast/private.wav?signature=secret",
      expiresAt: "2026-08-12T00:05:00.000Z",
    })
    const fetcher = vi.fn<typeof fetch>()
    const createAudioAccess = vi.fn(() => Effect.succeed(access))
    const runtime = makeGatewayWebHandler(
      { ...ports, createAudioAccess },
      Layer.empty,
      { fetcher }
    )

    try {
      const response = await runtime.handler(
        new Request(
          "http://gateway.test/v1/episodes/3c4d046c-b47b-4047-a562-66ac7e74e995/audio",
          { headers: { range: "bytes=0-3,8-11" } }
        )
      )

      expect(response.status).toBe(416)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(fetcher).not.toHaveBeenCalled()
      expect(createAudioAccess).not.toHaveBeenCalled()
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
          body: JSON.stringify({
            trigger: "manual",
            articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
          }),
        })
      )

      expect(response.status).toBe(400)
      expect(calls).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })

  it("returns the accepted job resource in Location", async () => {
    const receipt = Schema.decodeUnknownSync(JobReceiptSchema)({
      id: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
      status: "queued",
      createdAt: "2026-08-12T00:00:00.000Z",
      attempt: 0,
      maxAttempts: 4,
    })
    const runtime = makeGatewayWebHandler({
      ...ports,
      createEpisodeJob: () => Effect.succeed(receipt),
    })

    try {
      const response = await runtime.handler(
        new Request("http://gateway.test/v1/episode-jobs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "daily-2026-08-12",
          },
          body: JSON.stringify({
            trigger: "manual",
            articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
          }),
        })
      )

      expect(response.status).toBe(202)
      expect(response.headers.get("location")).toBe(
        `/v1/episode-jobs/${receipt.id}`
      )
    } finally {
      await runtime.dispose()
    }
  })

  it("proxies authorized replay HTML and assets with locked-down headers", async () => {
    const snapshotId = "6518412b-ce2f-4641-9f2c-a02dd515bc31"
    const assetName = `${"a".repeat(64)}.css`
    const bodies = new Map([
      ["Replay", "<!doctype html><p>saved</p>"],
      ["Asset", "p{color:green}"],
    ])
    const runtime = makeGatewayWebHandler(
      {
        ...ports,
        createArticleReplayAccess: ({ object }) => {
          const body = bodies.get(object.kind)!
          return Effect.succeed({
            url: `https://objects.test/${object.kind}`,
            mediaType:
              object.kind === "Replay"
                ? "text/html; charset=utf-8"
                : "text/css",
            byteLength: new TextEncoder().encode(body).byteLength,
            sha256: createHash("sha256").update(body).digest("hex"),
          })
        },
      },
      undefined,
      {
        fetcher: vi.fn(async (url) => {
          const kind = String(url).endsWith("Replay") ? "Replay" : "Asset"
          const body = bodies.get(kind)!
          return new Response(body, {
            headers: {
              "content-length": String(
                new TextEncoder().encode(body).byteLength
              ),
            },
          })
        }),
      }
    )

    try {
      const location = await runtime.handler(
        new Request(
          `http://gateway.test/v1/me/article-snapshots/${snapshotId}/replay`
        )
      )
      expect(await location.json()).toEqual({
        url: `/v1/me/article-snapshots/${snapshotId}/replay/index.html`,
      })

      const replay = await runtime.handler(
        new Request(
          `http://gateway.test/v1/me/article-snapshots/${snapshotId}/replay/index.html`
        )
      )
      expect(await replay.text()).toContain("saved")
      expect(replay.headers.get("content-security-policy")).toContain(
        "sandbox; default-src 'none'"
      )
      expect(replay.headers.get("x-content-type-options")).toBe("nosniff")

      const asset = await runtime.handler(
        new Request(
          `http://gateway.test/v1/me/article-snapshots/${snapshotId}/assets/${assetName}`
        )
      )
      expect(await asset.text()).toBe("p{color:green}")
      expect(asset.headers.get("content-type")).toContain("text/css")
      expect(asset.headers.get("cache-control")).toBe("private, no-store")
      expect(asset.headers.get("content-security-policy")).toContain(
        "sandbox; default-src 'none'"
      )
    } finally {
      await runtime.dispose()
    }
  })

  it("rejects a replay whose completed body does not match durable metadata", async () => {
    const snapshotId = "6518412b-ce2f-4641-9f2c-a02dd515bc31"
    const body = "same-length-corruption"
    const runtime = makeGatewayWebHandler(
      {
        ...ports,
        createArticleReplayAccess: () =>
          Effect.succeed({
            url: "https://objects.test/Replay",
            mediaType: "text/html; charset=utf-8",
            byteLength: new TextEncoder().encode(body).byteLength,
            sha256: "f".repeat(64),
          }),
      },
      undefined,
      {
        fetcher: vi.fn(
          async () =>
            new Response(body, {
              headers: {
                "content-length": String(
                  new TextEncoder().encode(body).byteLength
                ),
              },
            })
        ),
      }
    )

    try {
      const response = await runtime.handler(
        new Request(
          `http://gateway.test/v1/me/article-snapshots/${snapshotId}/replay/index.html`
        )
      )
      expect(response.status).toBe(503)
    } finally {
      await runtime.dispose()
    }
  })

  it("returns unavailable when the replay body fails before completion", async () => {
    const snapshotId = "6518412b-ce2f-4641-9f2c-a02dd515bc31"
    const runtime = makeGatewayWebHandler(
      {
        ...ports,
        createArticleReplayAccess: () =>
          Effect.succeed({
            url: "https://objects.test/Replay",
            mediaType: "text/html; charset=utf-8",
            byteLength: 4,
            sha256: "f".repeat(64),
          }),
      },
      undefined,
      {
        fetcher: vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("sa"))
                  controller.error(new Error("object store disconnected"))
                },
              }),
              { headers: { "content-length": "4" } }
            )
        ),
      }
    )

    try {
      const response = await runtime.handler(
        new Request(
          `http://gateway.test/v1/me/article-snapshots/${snapshotId}/replay/index.html`
        )
      )
      expect(response.status).toBe(503)
    } finally {
      await runtime.dispose()
    }
  })
})
