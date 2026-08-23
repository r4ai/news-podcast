import { Effect, Schema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { describe, expect, it } from "vitest"

import {
  AddFeedSubscriptionRequestSchema,
  CreateEpisodeJobHeadersSchema,
  CreateEpisodeJobRequestSchema,
  EpisodeSchema,
  gatewayApi,
  generateOpenApi,
  JobReceiptSchema,
} from "./contract.js"

const validArticleId = "5af55f2e-ff0b-475c-866a-f2cff48c101d"

describe("gateway HttpApi contract", () => {
  it("keeps the public idempotency key within the RPC limit", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateEpisodeJobHeadersSchema)({
        "idempotency-key": "x".repeat(129),
      })
    ).toThrow()
  })
  it("generates the complete public OpenAPI 3.1 surface", () => {
    const specification = generateOpenApi()

    expect(specification.openapi).toBe("3.1.0")
    expect(specification.info).toMatchObject({
      title: "RSS News Podcast API",
      version: "1.0.0",
    })
    expect(Object.keys(specification.paths).sort()).toEqual([
      "/api/auth/state",
      "/health",
      "/v1/episode-jobs",
      "/v1/episode-jobs/{jobId}",
      "/v1/episode-jobs/{jobId}/cancel",
      "/v1/episode-jobs/{jobId}/events",
      "/v1/episode-jobs/{jobId}/retry",
      "/v1/episodes",
      "/v1/episodes/{episodeId}",
      "/v1/episodes/{episodeId}/audio",
      "/v1/feeds",
      "/v1/me/article-snapshots/{snapshotId}/assets/{assetName}",
      "/v1/me/article-snapshots/{snapshotId}/replay",
      "/v1/me/article-snapshots/{snapshotId}/replay/index.html",
      "/v1/me/articles",
      "/v1/me/articles/bulk-state",
      "/v1/me/articles/facets",
      "/v1/me/articles/{articleId}",
      "/v1/me/articles/{articleId}/archive",
      "/v1/me/articles/{articleId}/enrich",
      "/v1/me/articles/{articleId}/markdown",
      "/v1/me/articles/{articleId}/tags",
      "/v1/me/enrich/queue",
      "/v1/me/enrich/reprocess",
      "/v1/me/enrich/reset-daily",
      "/v1/me/feed-subscriptions",
      "/v1/me/feed-subscriptions/{subscriptionId}",
      "/v1/me/feed-subscriptions/{subscriptionId}/sync",
      "/v1/me/feed-sync-jobs",
      "/v1/me/reading-dictionary",
      "/v1/me/reading-dictionary/{id}",
      "/v1/me/settings",
      "/v1/me/tag-suggestions",
      "/v1/me/tag-suggestions/promote",
      "/v1/me/tags",
      "/v1/me/tags/{tagId}",
    ])
    expect(specification.paths["/health"]?.get?.operationId).toBe("health")
    expect(specification.paths["/api/auth/state"]?.get?.operationId).toBe(
      "resolveSession"
    )
    expect(
      specification.paths["/v1/episode-jobs"]?.post?.responses
    ).toHaveProperty("202")
    expect(
      specification.paths["/v1/episode-jobs"]?.post?.responses?.["202"]?.headers
    ).toHaveProperty("location")
    expect(
      specification.paths["/v1/episodes/{episodeId}/audio"]?.get?.responses
    ).toHaveProperty("404")
    expect(
      specification.paths["/v1/me/feed-subscriptions"]?.post?.responses
    ).toHaveProperty("201")
    expect(
      specification.paths["/v1/me/feed-subscriptions/{subscriptionId}"]?.delete
        ?.responses
    ).toHaveProperty("204")
    expect(
      specification.paths["/v1/me/feed-subscriptions/{subscriptionId}/sync"]
        ?.post?.responses
    ).toHaveProperty("202")
  })

  it("documents global metadata and every public operation", () => {
    const specification = generateOpenApi()

    expect(specification.servers).toEqual([
      { url: "/", description: "Same-origin public Gateway" },
    ])
    expect((specification.info as Record<string, unknown>).contact).toEqual({
      name: "RSS News Podcast API maintainers",
      url: "https://github.com/r4ai/news-podcast/issues",
    })

    for (const pathItem of Object.values(specification.paths))
      for (const operation of Object.values(pathItem)) {
        if (
          typeof operation !== "object" ||
          operation === null ||
          !("operationId" in operation)
        )
          continue
        if (
          typeof operation.summary !== "string" ||
          typeof operation.description !== "string"
        )
          throw new Error(`missing documentation for ${operation.operationId}`)
        expect(operation.summary.length).toBeGreaterThan(0)
        expect(operation.description.length).toBeGreaterThan(0)
      }
  })

  it("accepts only canonical credential-free feed URLs", async () => {
    const valid = await Effect.runPromise(
      Schema.decodeUnknownEffect(AddFeedSubscriptionRequestSchema)({
        feedUrl: "https://feeds.example.com/news.xml",
      })
    )

    expect(valid.feedUrl).toBe("https://feeds.example.com/news.xml")
    for (const feedUrl of [
      "javascript:alert(1)",
      "https://user:secret@feeds.example.com/news.xml",
      "https://feeds.example.com/news.xml#section",
      "https://feeds.example.com/has space",
    ]) {
      const exit = await Effect.runPromiseExit(
        Schema.decodeUnknownEffect(AddFeedSubscriptionRequestSchema)({
          feedUrl,
        })
      )
      expect(exit._tag).toBe("Failure")
    }
  })

  it("is generated by Effect OpenApi without a handwritten document", () => {
    expect(generateOpenApi()).toEqual(OpenApi.fromApi(gatewayApi))
  })

  it("publishes only the closed public HTTP Problem variants", () => {
    const schemas = generateOpenApi().components?.schemas
    const problems = JSON.stringify({
      badRequest: schemas?.BadRequestProblem,
      unauthorized: schemas?.UnauthorizedProblem,
      notFound: schemas?.NotFoundProblem,
      conflict: schemas?.ConflictProblem,
      unprocessable: schemas?.UnprocessableProblem,
      unavailable: schemas?.UnavailableProblem,
    })

    for (const code of [
      "invalid_subscription_request",
      "authentication_required",
      "episode_not_found",
      "feed_subscription_not_found",
      "resource_not_found",
      "article_not_found",
      "episode_job_not_found",
      "idempotency_conflict",
      "resource_conflict",
      "job_terminal",
      "job_not_failed",
      "feed_subscription_rejected",
      "upstream_unavailable",
    ])
      expect(problems).toContain(code)
    expect(problems).not.toContain('"detail"')
  })

  it("publishes only article list capabilities implemented end to end", () => {
    const specification = generateOpenApi()
    const operation = specification.paths["/v1/me/articles"]?.get
    const queryNames = operation?.parameters
      ?.filter((parameter) => "in" in parameter && parameter.in === "query")
      .map((parameter) => ("name" in parameter ? parameter.name : undefined))
      .filter(Boolean)

    expect(queryNames?.sort()).toEqual([
      "cursor",
      "feedIds",
      "includeHidden",
      "limit",
      "q",
      "sort",
      "state",
    ])
    expect(JSON.stringify(specification.components?.schemas)).toContain(
      "Matches article title, source URL, or owner tag name."
    )
    const article = specification.components?.schemas?.Article
    expect(JSON.stringify(article)).not.toContain("usedInEpisode")
    expect(JSON.stringify(article)).not.toContain('"tags"')
  })

  it("publishes article pages as an opaque cursor contract", () => {
    const page = generateOpenApi().components?.schemas?.ArticlePage
    const properties = (page as { properties?: Record<string, unknown> })
      ?.properties
    const pageMeta = properties?.page as {
      properties?: Record<string, unknown>
      required?: readonly string[]
    }

    // hasMoreはfalse固定をやめ、nextCursorは次ページがある時だけ現れる。
    expect(pageMeta?.properties?.hasMore).toEqual({ type: "boolean" })
    expect(pageMeta?.required).toEqual(["hasMore"])
    expect(pageMeta?.properties).toHaveProperty("nextCursor")
    // totalCountは初期契約に入れない (docs/design.md §5)。
    expect(JSON.stringify(page)).not.toContain("totalCount")
  })

  it("parses only valid episode job creation payloads", async () => {
    const valid = await Effect.runPromise(
      Schema.decodeUnknownEffect(CreateEpisodeJobRequestSchema)({
        trigger: "manual",
        articleIds: [validArticleId],
      })
    )

    expect(valid).toEqual({
      trigger: "manual",
      articleIds: [validArticleId],
    })

    for (const invalid of [
      { trigger: "scheduled" },
      { trigger: "manual" },
      { trigger: "manual", articleIds: [] },
      { trigger: "manual", articleIds: ["article-1"] },
      {
        trigger: "manual",
        articleIds: [validArticleId, validArticleId],
      },
      {
        trigger: "manual",
        articleIds: Array.from({ length: 21 }, () => validArticleId),
      },
    ]) {
      const exit = await Effect.runPromiseExit(
        Schema.decodeUnknownEffect(CreateEpisodeJobRequestSchema)(invalid)
      )
      expect(exit._tag).toBe("Failure")
    }
  })

  it("rejects normalized calendar dates and whitespace-only domain text", async () => {
    const invalidReceipt = await Effect.runPromiseExit(
      Schema.decodeUnknownEffect(JobReceiptSchema)({
        id: "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
        status: "queued",
        createdAt: "2026-02-30T00:00:00.000Z",
        attempt: 0,
        maxAttempts: 4,
      })
    )
    const invalidEpisode = await Effect.runPromiseExit(
      Schema.decodeUnknownEffect(EpisodeSchema)({
        id: "3c4d046c-b47b-4047-a562-66ac7e74e995",
        title: "   ",
        script: "Valid script",
        sources: [
          {
            url: "https://example.com/article",
            title: "Source",
          },
        ],
        createdAt: "2026-08-12T00:00:00.000Z",
      })
    )

    expect(invalidReceipt._tag).toBe("Failure")
    expect(invalidEpisode._tag).toBe("Failure")
  })
})
