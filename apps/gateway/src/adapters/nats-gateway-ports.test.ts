import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  AddFeedSubscriptionReplySchema,
  ArticleLibraryReplySchema,
  CreateEpisodeJobReplySchema,
  CreateAudioAccessReplySchema,
  DeleteFeedSubscriptionReplySchema,
  EpisodeJobControlReplySchema,
  GetEpisodeReplySchema,
  ListFeedSubscriptionsReplySchema,
  ListEpisodesReplySchema,
  subjects,
} from "@news-podcast/protocols"

import {
  AudioAccessSchema,
  AddFeedSubscriptionRequestSchema,
  ArticleIdSchema,
  CreateEpisodeJobHeadersSchema,
  CreateEpisodeJobRequestSchema,
  EpisodeIdSchema,
  JobIdSchema,
  SubscriptionIdSchema,
} from "../contract.js"
import {
  type CapturedRequest,
  dependencies,
  encodedReply,
  fakeClient,
  ids,
  sessionHeaders,
  userId,
  userSessionReply,
} from "./nats/port-test-harness.js"
import {
  acquireNatsGatewayPorts,
  makeNatsGatewayPorts,
} from "./nats-gateway-ports.js"

const episodeId = "5af55f2e-ff0b-475c-866a-f2cff48c101d"

describe("NATS GatewayPorts adapter", () => {
  it("maps owner-scoped article operations without accepting an owner payload", async () => {
    const requests: CapturedRequest[] = []
    const article = {
      articleId: ids[3],
      feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
      title: "Stable article",
      sourceUrl: "https://example.com/article",
      publishedAt: null,
      discoveredAt: "2026-08-12T00:00:00.000Z",
      archiveStatus: "Succeeded",
      snapshotId: ids[4],
      state: {
        read: false,
        saved: true,
        readLater: false,
        hidden: false,
        hiddenAt: null,
      },
    }
    const client = fakeClient(async (request) => {
      if (request.subject === subjects.identity.resolveSession)
        return userSessionReply(request)
      requests.push(request)
      const payload = request.envelope.payload as Record<string, unknown>
      const listQuery = payload.query as
        | { readonly cursor?: string }
        | undefined
      expect(request.subject).toBe(subjects.content.articleLibrary)
      expect(request.envelope.actor).toEqual({ _tag: "User", userId })
      expect(payload).not.toHaveProperty("ownerId")
      const reply =
        payload.operation === "List"
          ? {
              _tag: "Listed",
              articles: [article],
              // カーソル未指定の1ページ目には続きがある、という応答。
              nextCursor: listQuery?.cursor === undefined ? "bmV4dA" : null,
            }
          : payload.operation === "Markdown"
            ? { _tag: "Markdown", markdown: "# Article" }
            : payload.operation === "BulkPatch"
              ? { _tag: "BulkUpdated", updated: 1 }
              : payload.operation === "Facets"
                ? {
                    _tag: "Facets",
                    facets: {
                      states: { all: 1, unread: 1, saved: 1, later: 0 },
                      feeds: [{ feedId: article.feedId, count: 1 }],
                    },
                  }
                : payload.operation === "Archive"
                  ? { _tag: "ArchiveTriggered", status: "AlreadyArchived" }
                  : payload.operation === "Patch"
                    ? { _tag: "Updated", article }
                    : { _tag: "Found", article }
      return encodedReply(
        request.envelope,
        "content-knowledge",
        ArticleLibraryReplySchema,
        reply
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())
    const articleId = Schema.decodeUnknownSync(ArticleIdSchema)(ids[3])
    const [listed, found, markdown, patched, bulk, facets, archived] =
      await Effect.runPromise(
        Effect.all(
          [
            ports.listArticles({ headers: sessionHeaders, query: {} }),
            ports.getArticle({ headers: sessionHeaders, articleId }),
            ports.getArticleMarkdown({ headers: sessionHeaders, articleId }),
            ports.patchArticle({
              headers: sessionHeaders,
              articleId,
              payload: { saved: true },
            }),
            ports.bulkPatchArticles({
              headers: sessionHeaders,
              payload: { read: true },
            }),
            ports.getArticleFacets({ headers: sessionHeaders, query: {} }),
            ports.archiveArticle({ headers: sessionHeaders, articleId }),
          ],
          { concurrency: 1 }
        )
      )

    expect(listed.items[0]).toMatchObject({
      id: article.articleId,
      saved: true,
    })
    expect(listed.page).toEqual({ hasMore: true, nextCursor: "bmV4dA" })
    expect(found.id).toBe(article.articleId)
    expect(markdown.markdown).toBe("# Article")
    expect(patched.saved).toBe(true)
    expect(bulk.updated).toBe(1)
    expect(facets.states.all).toBe(1)
    expect(archived.status).toBe("already_archived")
    expect(requests).toHaveLength(7)

    // 受け取ったカーソルをそのまま返すと、上流へ透過し、最終ページで畳まれる。
    const continued = await Effect.runPromise(
      ports.listArticles({
        headers: sessionHeaders,
        query: { cursor: listed.page.nextCursor! },
      })
    )
    expect(continued.page).toEqual({ hasMore: false })
    expect(
      (requests.at(-1)!.envelope.payload as { query: { cursor?: string } })
        .query.cursor
    ).toBe("bmV4dA")
  })

  it("maps feed catalog registration and pause through actor-owned RPCs", async () => {
    const requests: CapturedRequest[] = []
    const subscription = {
      subscriptionId: "9aa2225d-07e7-4af4-a8e6-e4788f801a91",
      feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
      feedUrl: "https://feeds.example.com/news.xml",
      enabled: true,
      createdAt: "2026-08-12T00:00:00.000Z",
    }
    const client = fakeClient(async (request) => {
      if (request.subject === subjects.identity.resolveSession)
        return userSessionReply(request)
      requests.push(request)
      expect(request.envelope.actor).toEqual({ _tag: "User", userId })
      expect(request.envelope.payload).not.toHaveProperty("ownerId")
      const reply =
        request.subject === subjects.content.listFeedCatalog
          ? {
              _tag: "Catalog",
              feeds: [
                { feedId: subscription.feedId, feedUrl: subscription.feedUrl },
              ],
            }
          : request.subject === subjects.content.updateSubscription
            ? { _tag: "Updated", subscription, enabled: false }
            : { _tag: "Added", subscription }
      return encodedReply(
        request.envelope,
        "content-knowledge",
        Schema.Unknown,
        reply
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())
    const subscriptionId = Schema.decodeUnknownSync(SubscriptionIdSchema)(
      subscription.subscriptionId
    )
    const [feeds, registered, paused] = await Effect.runPromise(
      Effect.all(
        [
          ports.listFeeds({ headers: sessionHeaders, q: "news" }),
          ports.registerFeed({
            headers: sessionHeaders,
            payload: Schema.decodeUnknownSync(AddFeedSubscriptionRequestSchema)(
              {
                feedUrl: subscription.feedUrl,
              }
            ),
          }),
          ports.updateFeedSubscription({
            headers: sessionHeaders,
            subscriptionId,
            payload: { enabled: false },
          }),
        ],
        { concurrency: 1 }
      )
    )

    expect(feeds.items).toEqual([
      {
        id: subscription.feedId,
        name: "feeds.example.com",
        siteUrl: "https://feeds.example.com/",
        feedUrl: subscription.feedUrl,
      },
    ])
    expect(registered.feed.id).toBe(subscription.feedId)
    expect(paused.enabled).toBe(false)
    expect(requests.map(({ subject }) => subject)).toEqual([
      subjects.content.listFeedCatalog,
      subjects.content.addSubscription,
      subjects.content.updateSubscription,
    ])
  })

  it("normalizes article tag, enrichment, and missing article outcomes", async () => {
    const tagId = "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
    const successClient = fakeClient(async (request) => {
      if (request.subject === subjects.identity.resolveSession)
        return userSessionReply(request)
      const operation = (request.envelope.payload as { operation?: string })
        .operation
      const reply =
        operation === "EnrichArticle"
          ? { _tag: "Enqueued", count: 1 }
          : {
              _tag: "ArticleTags",
              tags: [
                {
                  articleId: ids[3],
                  tagId,
                  name: "news",
                  source: "Manual",
                  confidence: null,
                },
                {
                  articleId: ids[3],
                  tagId,
                  name: "news",
                  source: "Ai",
                  confidence: 0.9,
                },
              ],
            }
      return encodedReply(
        request.envelope,
        "content-knowledge",
        Schema.Unknown,
        reply
      )
    })
    const ports = makeNatsGatewayPorts(successClient, dependencies())
    const articleId = Schema.decodeUnknownSync(ArticleIdSchema)(ids[3])
    const [listed, set, enriched] = await Effect.runPromise(
      Effect.all(
        [
          ports.listArticleTags({ headers: sessionHeaders, articleId }),
          ports.setArticleTags({
            headers: sessionHeaders,
            articleId,
            payload: { tagIds: [tagId] },
          }),
          ports.enrichArticle({ headers: sessionHeaders, articleId }),
        ],
        { concurrency: 1 }
      )
    )
    expect(listed.items.map(({ source }) => source)).toEqual(["manual", "ai"])
    expect(set.items).toHaveLength(2)
    expect(enriched.enqueued).toBe(1)

    const missingClient = fakeClient(async (request) =>
      request.subject === subjects.identity.resolveSession
        ? userSessionReply(request)
        : encodedReply(request.envelope, "content-knowledge", Schema.Unknown, {
            _tag: "NotFound",
          })
    )
    const missing = makeNatsGatewayPorts(missingClient, dependencies())
    const failures = await Effect.runPromise(
      Effect.all(
        [
          missing.getArticle({ headers: sessionHeaders, articleId }),
          missing.getArticleMarkdown({ headers: sessionHeaders, articleId }),
          missing.patchArticle({
            headers: sessionHeaders,
            articleId,
            payload: { read: true },
          }),
          missing.archiveArticle({ headers: sessionHeaders, articleId }),
          missing.listArticleTags({ headers: sessionHeaders, articleId }),
          missing.setArticleTags({
            headers: sessionHeaders,
            articleId,
            payload: { tagIds: [] },
          }),
          missing.enrichArticle({ headers: sessionHeaders, articleId }),
        ].map((effect) =>
          (effect as Effect.Effect<unknown, { readonly status: number }>).pipe(
            Effect.flip,
            Effect.map(({ status }) => status)
          )
        ),
        { concurrency: 1 }
      )
    )
    expect(failures).toEqual([404, 404, 404, 404, 404, 404, 404])

    const conflictClient = fakeClient(async (request) =>
      request.subject === subjects.identity.resolveSession
        ? userSessionReply(request)
        : encodedReply(request.envelope, "content-knowledge", Schema.Unknown, {
            _tag: "Conflict",
            code: "UNKNOWN_TAGS",
          })
    )
    const conflicted = makeNatsGatewayPorts(conflictClient, dependencies())
    const conflicts = await Effect.runPromise(
      Effect.all(
        [
          conflicted.setArticleTags({
            headers: sessionHeaders,
            articleId,
            payload: { tagIds: [] },
          }),
          conflicted.enrichArticle({ headers: sessionHeaders, articleId }),
        ].map((effect) =>
          (effect as Effect.Effect<unknown, { readonly status: number }>).pipe(
            Effect.flip,
            Effect.map(({ status }) => status)
          )
        ),
        { concurrency: 1 }
      )
    )
    expect(conflicts).toEqual([409, 409])
  })

  it("composes owner-only settings, taxonomy, and dictionary RPCs", async () => {
    const downstream: CapturedRequest[] = []
    const tagId = "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
    const client = fakeClient(async (request) => {
      if (request.subject === subjects.identity.resolveSession)
        return userSessionReply(request)
      downstream.push(request)
      expect(request.envelope.actor).toEqual({ _tag: "User", userId })
      expect(request.envelope.payload).not.toHaveProperty("ownerId")
      if (request.subject === subjects.identity.getGenerationSettings)
        return encodedReply(
          request.envelope,
          "identity-access",
          Schema.Unknown,
          {
            _tag: "Settings",
            generationSchedule: {
              enabled: true,
              localTime: "07:30",
              timeZone: "Asia/Tokyo",
            },
          }
        )
      if (request.subject === subjects.production.readingDictionary)
        return encodedReply(
          request.envelope,
          "episode-production",
          Schema.Unknown,
          {
            _tag: "Entries",
            entries: [
              {
                id: tagId,
                surface: "NHK",
                reading: "エヌエイチケー",
                accentType: 0,
                source: "manual",
                createdAt: "2026-08-12T00:00:00.000Z",
                updatedAt: "2026-08-12T00:00:00.000Z",
              },
            ],
          }
        )
      const operation = (request.envelope.payload as { operation: string })
        .operation
      return encodedReply(
        request.envelope,
        "content-knowledge",
        Schema.Unknown,
        operation === "GetInterestProfile"
          ? {
              _tag: "InterestProfile",
              interestProfile: { include: "AI", exclude: "sports" },
            }
          : {
              _tag: "Tags",
              tags: [
                { tagId, name: "AI", createdAt: "2026-08-12T00:00:00.000Z" },
              ],
            }
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())

    const [settings, tags, dictionary] = await Effect.runPromise(
      Effect.all(
        [
          ports.getSettings(sessionHeaders),
          ports.listTags(sessionHeaders),
          ports.listReadingDictionary(sessionHeaders),
        ],
        { concurrency: 1 }
      )
    )

    expect(settings).toEqual({
      generationSchedule: {
        enabled: true,
        localTime: "07:30",
        timeZone: "Asia/Tokyo",
      },
      interestProfile: { include: "AI", exclude: "sports" },
    })
    expect(tags.items).toMatchObject([{ id: tagId, name: "AI" }])
    expect(dictionary.items).toMatchObject([{ id: tagId, surface: "NHK" }])
    expect(downstream.map(({ subject }) => subject)).toEqual([
      subjects.identity.getGenerationSettings,
      subjects.content.personalization,
      subjects.content.personalization,
      subjects.production.readingDictionary,
    ])
  })

  it("maps personalization mutations and enrichment controls", async () => {
    const tagId = "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
    const timestamp = "2026-08-12T00:00:00.000Z"
    const tag = { tagId, name: "AI", createdAt: timestamp }
    const entry = {
      id: tagId,
      surface: "NHK",
      reading: "エヌエイチケー",
      accentType: 0,
      source: "manual",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const client = fakeClient(async (request) => {
      if (request.subject === subjects.identity.resolveSession)
        return userSessionReply(request)
      if (request.subject === subjects.identity.updateGenerationSettings)
        return encodedReply(
          request.envelope,
          "identity-access",
          Schema.Unknown,
          {
            _tag: "Settings",
            generationSchedule: {
              enabled: false,
              localTime: "08:00",
              timeZone: "UTC",
            },
          }
        )
      const operation = (request.envelope.payload as { operation: string })
        .operation
      if (request.subject === subjects.production.readingDictionary) {
        const payload =
          operation === "Delete"
            ? { _tag: "Deleted" }
            : { _tag: "Entry", entry }
        return encodedReply(
          request.envelope,
          "episode-production",
          Schema.Unknown,
          payload
        )
      }
      const payload =
        operation === "UpdateInterestProfile"
          ? {
              _tag: "InterestProfile",
              interestProfile: { include: "", exclude: "ads" },
            }
          : operation === "DeleteTag"
            ? { _tag: "Deleted" }
            : operation === "ListTagSuggestions"
              ? {
                  _tag: "Suggestions",
                  suggestions: [
                    { name: "Science", occurrences: 2, lastSeenAt: timestamp },
                  ],
                }
              : operation === "GetEnrichmentQueue"
                ? {
                    _tag: "EnrichmentQueue",
                    queue: {
                      processing: [],
                      pending: { count: 0, items: [] },
                      failed: { count: 0, items: [] },
                      recent: [
                        {
                          articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
                          title: "News",
                          sourceName: "Feed",
                          priority: 1,
                          reason: "New",
                          status: "Succeeded",
                          attempt: 1,
                          createdAt: timestamp,
                        },
                      ],
                      daily: { used: 0, limit: 100 },
                      reprocessable: { count: 0 },
                    },
                  }
                : operation === "ReprocessEnrichment"
                  ? { _tag: "Enqueued", count: 3 }
                  : operation === "ResetDailyEnrichment"
                    ? { _tag: "Reset" }
                    : { _tag: "Tag", tag }
      return encodedReply(
        request.envelope,
        "content-knowledge",
        Schema.Unknown,
        payload
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())

    const results = await Effect.runPromise(
      Effect.all(
        [
          ports.updateSettings({
            headers: sessionHeaders,
            payload: {
              generationSchedule: {
                enabled: false,
                localTime: "08:00",
                timeZone: "UTC",
              },
              interestProfile: { include: "", exclude: "ads" },
            },
          }),
          ports.createTag({ headers: sessionHeaders, payload: { name: "AI" } }),
          ports.deleteTag({ headers: sessionHeaders, tagId }),
          ports.listTagSuggestions(sessionHeaders),
          ports.promoteTagSuggestion({
            headers: sessionHeaders,
            payload: { name: "AI" },
          }),
          ports.createReadingDictionary({
            headers: sessionHeaders,
            payload: { surface: "NHK", reading: "エヌエイチケー" },
          }),
          ports.updateReadingDictionary({
            headers: sessionHeaders,
            id: tagId,
            payload: { accentType: 0 },
          }),
          ports.deleteReadingDictionary({ headers: sessionHeaders, id: tagId }),
          ports.getEnrichQueue(sessionHeaders),
          ports.enrichReprocess(sessionHeaders),
          ports.enrichResetDaily(sessionHeaders),
        ],
        { concurrency: 1 }
      )
    )

    expect(results[0]).toMatchObject({ interestProfile: { exclude: "ads" } })
    expect(results[3]).toMatchObject({ items: [{ name: "Science" }] })
    expect(results[9]).toEqual({ enqueued: 3 })
    expect(results[10]).toEqual({ message: "Daily enrichment usage reset" })
  })

  it("maps personalization ownership misses and conflicts without leaking upstream errors", async () => {
    const firstId = "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
    const secondId = "0c6bd9aa-f349-4c16-af84-acb845aa9d47"
    const client = fakeClient(async (request) => {
      if (request.subject === subjects.identity.resolveSession)
        return userSessionReply(request)
      if (
        request.subject === subjects.identity.getGenerationSettings ||
        request.subject === subjects.identity.updateGenerationSettings
      )
        return encodedReply(
          request.envelope,
          "identity-access",
          Schema.Unknown,
          {
            _tag: "Settings",
            generationSchedule: {
              enabled: true,
              localTime: "07:30",
              timeZone: "Asia/Tokyo",
            },
          }
        )
      const payload = request.envelope.payload as {
        operation: string
        id?: string
      }
      if (request.subject === subjects.production.readingDictionary) {
        const reply =
          payload.operation === "Create"
            ? { _tag: "Conflict" }
            : payload.operation === "Update" && payload.id === secondId
              ? { _tag: "Conflict" }
              : { _tag: "NotFound" }
        return encodedReply(
          request.envelope,
          "episode-production",
          Schema.Unknown,
          reply
        )
      }
      const reply =
        payload.operation === "GetInterestProfile" ||
        payload.operation === "UpdateInterestProfile"
          ? {
              _tag: "InterestProfile",
              interestProfile: { include: "", exclude: "" },
            }
          : { _tag: "NotFound" }
      return encodedReply(
        request.envelope,
        "content-knowledge",
        Schema.Unknown,
        reply
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())

    const failures = await Effect.runPromise(
      Effect.forEach(
        [
          ports.deleteTag({ headers: sessionHeaders, tagId: firstId }),
          ports.promoteTagSuggestion({
            headers: sessionHeaders,
            payload: { name: "missing" },
          }),
          ports.createReadingDictionary({
            headers: sessionHeaders,
            payload: { surface: "NHK", reading: "エヌエイチケー" },
          }),
          ports.updateReadingDictionary({
            headers: sessionHeaders,
            id: firstId,
            payload: { accentType: 0 },
          }),
          ports.updateReadingDictionary({
            headers: sessionHeaders,
            id: secondId,
            payload: { accentType: 0 },
          }),
          ports.deleteReadingDictionary({
            headers: sessionHeaders,
            id: firstId,
          }),
        ],
        (effect) => effect.pipe(Effect.flip),
        { concurrency: 1 }
      )
    )
    const partialSettings = await Effect.runPromise(
      Effect.all(
        [
          ports.updateSettings({
            headers: sessionHeaders,
            payload: { interestProfile: { include: "", exclude: "" } },
          }),
          ports.updateSettings({
            headers: sessionHeaders,
            payload: {
              generationSchedule: {
                enabled: true,
                localTime: "07:30",
                timeZone: "Asia/Tokyo",
              },
            },
          }),
        ],
        { concurrency: 1 }
      )
    )

    expect(failures.map(({ status }) => status)).toEqual([
      404, 404, 409, 404, 409, 404,
    ])
    expect(partialSettings).toHaveLength(2)
  })

  it("maps owner-scoped production job control and bounded replay RPCs", async () => {
    const requests: CapturedRequest[] = []
    const queued = {
      jobId: ids[0],
      trigger: "manual",
      status: "queued",
      attempt: 0,
      maxAttempts: 4,
      createdAt: "2026-08-12T00:00:00.000Z",
      enqueuedAt: "2026-08-12T00:00:00.000Z",
    }
    const client = fakeClient(async (request) => {
      requests.push(request)
      if (request.subject === subjects.identity.resolveSession)
        return userSessionReply(request)
      const payload = request.envelope.payload as Record<string, unknown>
      const reply =
        request.subject === subjects.production.listJobs
          ? { _tag: "Listed", jobs: [queued] }
          : request.subject === subjects.production.listJobEvents
            ? { _tag: "Events", events: [{ sequence: 2, job: queued }] }
            : request.subject === subjects.production.cancelJob
              ? {
                  _tag: "Canceled",
                  job: {
                    jobId: queued.jobId,
                    trigger: queued.trigger,
                    createdAt: queued.createdAt,
                    status: "canceled",
                    attempt: queued.attempt,
                    maxAttempts: queued.maxAttempts,
                    canceledAt: "2026-08-12T00:02:00.000Z",
                    reason: "requested_by_user",
                  },
                }
              : request.subject === subjects.production.retryJob
                ? { _tag: "Retried", job: queued }
                : { _tag: "Found", job: queued }
      expect(payload).not.toHaveProperty("ownerId")
      return encodedReply(
        request.envelope,
        "episode-production",
        EpisodeJobControlReplySchema,
        reply
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())
    const jobId = Schema.decodeUnknownSync(JobIdSchema)(ids[0])

    const [listed, found, canceled, retried, replay] = await Effect.runPromise(
      Effect.all(
        [
          ports.listEpisodeJobs({ headers: sessionHeaders, limit: 20 }),
          ports.getEpisodeJob({ headers: sessionHeaders, jobId }),
          ports.cancelEpisodeJob({ headers: sessionHeaders, jobId }),
          ports.retryEpisodeJob({
            headers: sessionHeaders,
            jobId,
            idempotencyKey: "retry-home",
          }),
          ports.replayEpisodeJobEvents({
            headers: sessionHeaders,
            jobId,
            afterSequence: 1,
          }),
        ],
        { concurrency: 1 }
      )
    )

    expect(listed.items).toHaveLength(1)
    expect(found.id).toBe(ids[0])
    expect(canceled.status).toBe("canceled")
    expect(retried).toMatchObject({ status: "queued", attempt: 0 })
    expect(replay.events).toMatchObject([{ sequence: 2 }])
    const downstream = requests.filter(
      ({ subject }) => subject !== subjects.identity.resolveSession
    )
    expect(downstream.map(({ subject }) => subject)).toEqual([
      subjects.production.listJobs,
      subjects.production.getJob,
      subjects.production.cancelJob,
      subjects.production.retryJob,
      subjects.production.getJob,
      subjects.production.listJobEvents,
    ])
    expect(downstream.at(-1)?.envelope.payload).toEqual({
      jobId: ids[0],
      afterSequence: 1,
      limit: 100,
    })
  })

  it("resolves the HTTP session through a correlated versioned NATS envelope", async () => {
    const requests: CapturedRequest[] = []
    const client = fakeClient(async (request) => {
      requests.push(request)
      return userSessionReply(request)
    })
    const ports = makeNatsGatewayPorts(client, dependencies())

    const session = await Effect.runPromise(
      ports.resolveSession(sessionHeaders)
    )

    expect(session).toEqual({
      authenticated: true,
      userId,
      loginMethods: { development: false, google: true },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      subject: subjects.identity.resolveSession,
      timeoutMillis: 2_000,
      envelope: {
        actor: { _tag: "Anonymous" },
        producer: "gateway",
        correlationId: ids[0],
        causationId: ids[0],
        payload: {
          headers: [
            { name: "authorization", value: "Bearer opaque" },
            { name: "cookie", value: "session=opaque" },
          ],
        },
      },
    })
    expect(String(requests[0]?.envelope.traceparent)).toMatch(
      /^00-4bf92f3577b34da6a3ce929d0e0e4736-[\da-f]{16}-01$/
    )
  })

  it("composes actor resolution before each authenticated context RPC", async () => {
    const requests: CapturedRequest[] = []
    const client = fakeClient(async (request) => {
      requests.push(request)
      if (request.subject === subjects.identity.resolveSession) {
        return userSessionReply(request)
      }
      if (request.subject === subjects.production.createJob) {
        return encodedReply(
          request.envelope,
          "episode-production",
          CreateEpisodeJobReplySchema,
          {
            _tag: "Accepted",
            jobId: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
            state: "Queued",
          }
        )
      }
      if (request.subject === "library.list-episodes.v1") {
        return encodedReply(
          request.envelope,
          "episode-library",
          ListEpisodesReplySchema,
          { _tag: "Listed", page: { items: [], page: { hasMore: false } } }
        )
      }
      if (request.subject === subjects.library.getEpisode) {
        return encodedReply(
          request.envelope,
          "episode-library",
          GetEpisodeReplySchema,
          {
            _tag: "Found",
            episode: {
              id: episodeId,
              title: "Daily news",
              script: "Immutable script",
              createdAt: "2026-08-12T00:00:00.000Z",
              sources: [
                {
                  sourceKind: "web",
                  url: "https://example.com/story",
                  title: "Story",
                },
              ],
            },
          }
        )
      }
      return encodedReply(
        request.envelope,
        "episode-library",
        CreateAudioAccessReplySchema,
        {
          _tag: "Found",
          access: {
            url: "https://audio.example.test/episode.wav?token=opaque",
            expiresAt: "2026-08-12T00:05:00.000Z",
          },
        }
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())

    const receipt = await Effect.runPromise(
      ports.createEpisodeJob({
        headers: Schema.decodeUnknownSync(CreateEpisodeJobHeadersSchema)({
          ...sessionHeaders,
          "idempotency-key": "daily-2026-08-12",
        }),
        payload: Schema.decodeUnknownSync(CreateEpisodeJobRequestSchema)({
          trigger: "manual",
          articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
        }),
      })
    )
    const page = await Effect.runPromise(
      ports.listEpisodes({ headers: sessionHeaders, cursor: "opaque-cursor" })
    )
    const episode = await Effect.runPromise(
      ports.getEpisode({
        headers: sessionHeaders,
        episodeId: Schema.decodeUnknownSync(EpisodeIdSchema)(episodeId),
      })
    )
    const access = await Effect.runPromise(
      ports.createAudioAccess({
        headers: sessionHeaders,
        episodeId: Schema.decodeUnknownSync(EpisodeIdSchema)(episodeId),
      })
    )

    expect(receipt.status).toBe("queued")
    expect(page.items).toEqual([])
    expect(episode.id).toBe(episodeId)
    expect(Schema.decodeUnknownSync(AudioAccessSchema)(access).expiresAt).toBe(
      "2026-08-12T00:05:00.000Z"
    )
    const downstream = requests.filter(
      ({ subject }) => subject !== subjects.identity.resolveSession
    )
    expect(downstream.map(({ subject }) => subject)).toEqual([
      subjects.production.createJob,
      subjects.library.listEpisodes,
      subjects.library.getEpisode,
      subjects.library.createAudioAccess,
    ])
    for (const request of downstream) {
      expect(request.envelope.actor).toEqual({ _tag: "User", userId })
      const priorIdentityRequest = requests[requests.indexOf(request) - 1]!
      expect(request.envelope.correlationId).toBe(
        priorIdentityRequest.envelope.correlationId
      )
      expect(request.envelope.causationId).toBe(
        priorIdentityRequest.envelope.messageId
      )
    }
    expect(downstream[0]?.envelope.payload).toMatchObject({
      idempotencyKey: "daily-2026-08-12",
      trigger: "manual",
      articleIds: ["f8f15e30-6877-4b4d-9568-76bfa3dc3e40"],
    })
    expect(downstream[1]?.envelope.payload).toEqual({ cursor: "opaque-cursor" })
  })

  it("stops before the domain RPC when the resolved actor is anonymous", async () => {
    const request = vi.fn(async (captured: CapturedRequest) =>
      encodedReply(
        captured.envelope,
        "identity-access",
        Schema.Struct({
          actor: Schema.Struct({ _tag: Schema.Literal("Anonymous") }),
        }),
        { actor: { _tag: "Anonymous" } }
      )
    )
    const ports = makeNatsGatewayPorts(fakeClient(request), dependencies())

    const problem = await Effect.runPromise(
      ports.listEpisodes({ headers: sessionHeaders }).pipe(Effect.flip)
    )

    expect(problem).toMatchObject({
      status: 401,
      code: "authentication_required",
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it("maps owner-scoped subscription commands through correlated content RPCs", async () => {
    const requests: CapturedRequest[] = []
    const subscription = {
      subscriptionId: "9aa2225d-07e7-4af4-a8e6-e4788f801a91",
      feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
      feedUrl: "https://feeds.example.com/news.xml",
      enabled: true,
      createdAt: "2026-08-12T00:00:00.000Z",
    }
    const publicSubscription = {
      id: subscription.subscriptionId,
      feedId: subscription.feedId,
      enabled: true,
      createdAt: subscription.createdAt,
    }
    const client = fakeClient(async (request) => {
      requests.push(request)
      if (request.subject === subjects.identity.resolveSession) {
        return userSessionReply(request)
      }
      if (request.subject === subjects.content.addSubscription) {
        return encodedReply(
          request.envelope,
          "content-knowledge",
          AddFeedSubscriptionReplySchema,
          {
            _tag: "Added",
            subscription,
          }
        )
      }
      if (request.subject === subjects.content.listSubscriptions) {
        return encodedReply(
          request.envelope,
          "content-knowledge",
          ListFeedSubscriptionsReplySchema,
          {
            _tag: "Listed",
            subscriptions: [subscription],
          }
        )
      }
      return encodedReply(
        request.envelope,
        "content-knowledge",
        DeleteFeedSubscriptionReplySchema,
        {
          _tag: "Deleted",
        }
      )
    })
    const ports = makeNatsGatewayPorts(client, dependencies())

    await expect(
      Effect.runPromise(
        ports.addFeedSubscription({
          headers: sessionHeaders,
          payload: Schema.decodeUnknownSync(AddFeedSubscriptionRequestSchema)({
            feedUrl: subscription.feedUrl,
          }),
        })
      )
    ).resolves.toEqual(publicSubscription)
    await expect(
      Effect.runPromise(ports.listFeedSubscriptions(sessionHeaders))
    ).resolves.toEqual({
      items: [publicSubscription],
      page: { hasMore: false },
    })
    await expect(
      Effect.runPromise(
        ports.deleteFeedSubscription({
          headers: sessionHeaders,
          subscriptionId: Schema.decodeUnknownSync(SubscriptionIdSchema)(
            subscription.subscriptionId
          ),
        })
      )
    ).resolves.toBeUndefined()

    expect(
      requests
        .filter(({ subject }) => subject !== subjects.identity.resolveSession)
        .map(({ subject, envelope }) => ({
          subject,
          payload: envelope.payload,
        }))
    ).toEqual([
      {
        subject: subjects.content.addSubscription,
        payload: { feedUrl: subscription.feedUrl },
      },
      { subject: subjects.content.listSubscriptions, payload: {} },
      {
        subject: subjects.content.deleteSubscription,
        payload: { subscriptionId: subscription.subscriptionId },
      },
    ])
  })

  it("maps content not-found and malformed replies without leaking boundary data", async () => {
    const subscriptionId = Schema.decodeUnknownSync(SubscriptionIdSchema)(
      "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
    )
    const request = vi.fn(async (subject: string, data: Uint8Array) => {
      const envelope = JSON.parse(new TextDecoder().decode(data)) as Record<
        string,
        unknown
      >
      const captured = { subject, timeoutMillis: 2_000, envelope }
      if (subject === subjects.identity.resolveSession)
        return userSessionReply(captured)
      return encodedReply(
        envelope,
        "content-knowledge",
        DeleteFeedSubscriptionReplySchema,
        { _tag: "NotFound" }
      )
    })
    const ports = makeNatsGatewayPorts(
      { request, drain: async () => undefined },
      dependencies()
    )

    const notFoundProblem = await Effect.runPromise(
      ports
        .deleteFeedSubscription({ headers: sessionHeaders, subscriptionId })
        .pipe(Effect.flip)
    )

    expect(notFoundProblem).toMatchObject({
      status: 404,
      code: "feed_subscription_not_found",
    })
  })

  it.each([
    ["add invalid", subjects.content.addSubscription, "INVALID_REQUEST", 422],
    [
      "add unauthenticated",
      subjects.content.addSubscription,
      "UNAUTHENTICATED",
      401,
    ],
    [
      "list unauthenticated",
      subjects.content.listSubscriptions,
      "UNAUTHENTICATED",
      401,
    ],
    [
      "delete invalid",
      subjects.content.deleteSubscription,
      "INVALID_REQUEST",
      400,
    ],
    [
      "delete protocol not-found",
      subjects.content.deleteSubscription,
      "NOT_FOUND",
      404,
    ],
    [
      "delete unavailable",
      subjects.content.deleteSubscription,
      "STORAGE_FAILURE",
      503,
    ],
  ] as const)(
    "maps %s Content rejection",
    async (_case, subject, code, status) => {
      const client = fakeClient(async (request) => {
        if (request.subject === subjects.identity.resolveSession)
          return userSessionReply(request)
        return encodedReply(
          request.envelope,
          "content-knowledge",
          Schema.Unknown,
          {
            _tag: "Rejected",
            code,
          }
        )
      })
      const ports = makeNatsGatewayPorts(client, dependencies())
      const problem =
        subject === subjects.content.addSubscription
          ? await Effect.runPromise(
              ports
                .addFeedSubscription({
                  headers: sessionHeaders,
                  payload: Schema.decodeUnknownSync(
                    AddFeedSubscriptionRequestSchema
                  )({ feedUrl: "https://feeds.example.com/news.xml" }),
                })
                .pipe(Effect.flip)
            )
          : subject === subjects.content.listSubscriptions
            ? await Effect.runPromise(
                ports.listFeedSubscriptions(sessionHeaders).pipe(Effect.flip)
              )
            : await Effect.runPromise(
                ports
                  .deleteFeedSubscription({
                    headers: sessionHeaders,
                    subscriptionId: Schema.decodeUnknownSync(
                      SubscriptionIdSchema
                    )("9aa2225d-07e7-4af4-a8e6-e4788f801a91"),
                  })
                  .pipe(Effect.flip)
              )
      expect(problem.status).toBe(status)
    }
  )

  it.each([
    ["NATS timeout", async () => Promise.reject(new Error("TIMEOUT"))],
    ["invalid JSON", async () => new TextEncoder().encode("not-json")],
  ])("maps %s to the existing unavailable Problem", async (_case, request) => {
    const ports = makeNatsGatewayPorts(
      { request, drain: async () => undefined },
      dependencies()
    )

    const problem = await Effect.runPromise(
      ports.resolveSession(sessionHeaders).pipe(Effect.flip)
    )

    expect(problem).toMatchObject({ status: 503, code: "upstream_unavailable" })
  })

  it("rejects a well-formed response from a different correlation chain", async () => {
    const client = fakeClient((request) =>
      encodedReply(
        { ...request.envelope, correlationId: ids[4] },
        "identity-access",
        Schema.Struct({
          actor: Schema.Struct({ _tag: Schema.Literal("Anonymous") }),
        }),
        { actor: { _tag: "Anonymous" } }
      )
    )
    const ports = makeNatsGatewayPorts(client, dependencies())

    const problem = await Effect.runPromise(
      ports.resolveSession(sessionHeaders).pipe(Effect.flip)
    )

    expect(problem).toMatchObject({ status: 503, code: "upstream_unavailable" })
  })

  it.each(["producer", "service actor", "causation"] as const)(
    "rejects a reply with forged %s metadata",
    async (field) => {
      const client = fakeClient(async (request) => {
        const bytes = await encodedReply(
          field === "causation"
            ? { ...request.envelope, messageId: ids[4] }
            : request.envelope,
          field === "producer" ? "forged-service" : "identity-access",
          Schema.Struct({
            actor: Schema.Struct({ _tag: Schema.Literal("Anonymous") }),
          }),
          { actor: { _tag: "Anonymous" } }
        )
        if (field !== "service actor") return bytes
        const envelope = JSON.parse(new TextDecoder().decode(bytes)) as Record<
          string,
          unknown
        >
        envelope.actor = { _tag: "Service", service: "forged-service" }
        return new TextEncoder().encode(JSON.stringify(envelope))
      })
      const ports = makeNatsGatewayPorts(client, dependencies())

      const problem = await Effect.runPromise(
        ports.resolveSession(sessionHeaders).pipe(Effect.flip)
      )

      expect(problem).toMatchObject({
        status: 503,
        code: "upstream_unavailable",
      })
    }
  )

  it("acquires and drains the NATS connection within an Effect scope", async () => {
    const drain = vi.fn(async () => undefined)
    const client = {
      ...fakeClient(async () => new Uint8Array()),
      drain,
    }
    const connect = vi.fn(async () => client)

    await Effect.runPromise(
      Effect.scoped(
        acquireNatsGatewayPorts(
          {
            natsServers: ["nats://127.0.0.1:4222"],
            requestTimeoutMillis: 2_000,
            loginMethods: { development: false, google: true },
          },
          { ...dependencies(), connect }
        ).pipe(Effect.asVoid)
      )
    )

    expect(connect).toHaveBeenCalledWith(["nats://127.0.0.1:4222"])
    expect(drain).toHaveBeenCalledOnce()
  })
})
