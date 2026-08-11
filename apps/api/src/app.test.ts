import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import {
  noopObservability,
  type Observability,
  type SpanOptions,
} from "@news-podcast/observability"
import { LocalStore } from "@news-podcast/adapters/db/local"

import { createApp } from "./app.js"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function openStore(): LocalStore {
  const directory = mkdtempSync(join(tmpdir(), "news-podcast-api-articles-"))
  directories.push(directory)
  return new LocalStore(join(directory, "app.sqlite"))
}

describe("API foundation", () => {
  it("serves a credential-free health check", async () => {
    const response = await createApp().request("/health")
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "ok" })
  })

  it("reports unauthenticated state without caching it", async () => {
    const response = await createApp({
      authHandler: () => new Response(null, { status: 404 }),
      loginMethods: { development: true, google: false },
      resolveOwner: async () => null,
    }).request("/api/auth/state")

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      loginMethods: { development: true, google: false },
    })
  })

  it("reports authenticated state for either session implementation", async () => {
    const response = await createApp({
      loginMethods: { development: false, google: true },
      resolveOwner: async () => "00000000-0000-4000-8000-000000000100",
    }).request("/api/auth/state")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      loginMethods: { development: false, google: true },
    })
  })

  it("returns a contract-shaped 503 when protected-route authentication fails", async () => {
    const response = await createApp({
      resolveOwner: () => Promise.reject(new Error("session store down")),
    }).request("/v1/feeds")

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      status: 503,
      code: "service-unavailable",
    })
  })

  it("keeps authentication infrastructure failures distinct", async () => {
    const response = await createApp({
      resolveOwner: () => Promise.reject(new Error("session store down")),
    }).request("/api/auth/state")

    expect(response.status).toBe(503)
  })

  it("returns 202 and resource headers from the episode job seam", async () => {
    const response = await createApp({
      resolveOwner: async () => "00000000-0000-4000-8000-000000000100",
      createEpisodeJob: async () => ({
        id: "00000000-0000-4000-8000-000000000001",
        status: "queued",
        createdAt: "2026-08-09T00:00:00.000Z",
        attempt: 0,
        maxAttempts: 4,
      }),
    }).request("/v1/episode-jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "test",
      },
      body: JSON.stringify({ trigger: "manual" }),
    })
    expect(response.status).toBe(202)
    expect(response.headers.get("Location")).toBe(
      "/v1/episode-jobs/00000000-0000-4000-8000-000000000001"
    )
    expect(response.headers.get("Idempotency-Key")).toBe("test")
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
    })
  })

  it("passes W3C request context to the API request span without baggage", async () => {
    let spanOptions: SpanOptions | undefined
    const observability: Observability = {
      ...noopObservability,
      withSpan: async (_name, _attributes, operation, options) => {
        spanOptions = options
        return operation()
      },
    }
    const response = await createApp({
      observability,
      resolveOwner: async () => "owner-1",
    }).request("/v1/feeds", {
      headers: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "vendor=value",
        baggage: "private=value",
      },
    })

    expect(response.status).toBe(503)
    expect(spanOptions).toEqual({
      parent: {
        traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        traceState: "vendor=value",
      },
    })
  })

  it("discovers and subscribes to an arbitrary RSS URL", async () => {
    const response = await createApp({
      resolveOwner: async () => "owner-1",
      discoverFeed: async (_ownerId, feedUrl) => ({
        feed: {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Example",
          siteUrl: "https://example.com",
          feedUrl,
        },
        subscription: {
          id: "00000000-0000-4000-8000-000000000002",
          feedId: "00000000-0000-4000-8000-000000000001",
          enabled: true,
          createdAt: "2026-08-10T00:00:00.000Z",
        },
      }),
    }).request("/v1/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedUrl: "https://example.com/feed.xml" }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      feed: { name: "Example" },
      subscription: { enabled: true },
    })
  })

  it("forwards authenticated same-origin OTLP without exposing the collector", async () => {
    const forwarded: Array<{ signal: string; size: number }> = []
    const app = createApp({
      resolveOwner: async () => "owner-1",
      telemetryOrigin: "https://app.example.com",
      forwardTelemetry: async (signal, body) => {
        forwarded.push({ signal, size: body.byteLength })
      },
    })
    const response = await app.request("/v1/telemetry/traces", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-protobuf",
        Origin: "https://app.example.com",
      },
      body: new Uint8Array([1, 2, 3]),
    })

    expect(response.status).toBe(204)
    expect(forwarded).toEqual([{ signal: "traces", size: 3 }])
  })

  it("rejects unauthenticated, cross-origin, and oversized telemetry", async () => {
    const forwardTelemetry = async () => undefined
    const unauthenticated = await createApp({
      resolveOwner: async () => null,
      telemetryOrigin: "https://app.example.com",
      forwardTelemetry,
    }).request("/v1/telemetry/logs", telemetryRequest())
    expect(unauthenticated.status).toBe(401)

    const protectedApp = createApp({
      resolveOwner: async () => "owner-1",
      telemetryOrigin: "https://app.example.com",
      forwardTelemetry,
    })
    const crossOrigin = await protectedApp.request(
      "/v1/telemetry/logs",
      telemetryRequest("https://other.example.com")
    )
    expect(crossOrigin.status).toBe(403)

    const oversized = await protectedApp.request(
      "/v1/telemetry/metrics",
      telemetryRequest("https://app.example.com", 256 * 1024 + 1)
    )
    expect(oversized.status).toBe(413)
  })

  it("rate limits telemetry per authenticated owner", async () => {
    const app = createApp({
      resolveOwner: async () => "owner-1",
      telemetryOrigin: "https://app.example.com",
      forwardTelemetry: async () => undefined,
    })
    for (let request = 0; request < 60; request += 1) {
      const response = await app.request(
        "/v1/telemetry/traces",
        telemetryRequest()
      )
      expect(response.status).toBe(204)
    }
    const limited = await app.request(
      "/v1/telemetry/traces",
      telemetryRequest()
    )
    expect(limited.status).toBe(429)
  })

  it("paginates /v1/me/articles with cursor and reports hasMore/nextCursor", async () => {
    const store = openStore()
    const owner = "owner-1"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(
      feed.id,
      Array.from({ length: 5 }, (_, index) => ({
        externalId: `item-${index}`,
        title: `Article ${index}`,
        url: `https://example.com/${index}`,
        publishedAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      }))
    )
    const app = createApp({ store, resolveOwner: async () => owner })

    const firstResponse = await app.request("/v1/me/articles?limit=2")
    expect(firstResponse.status).toBe(200)
    const first = (await firstResponse.json()) as {
      items: Array<{ id: string }>
      page: { hasMore: boolean; nextCursor?: string }
    }
    expect(first.items).toHaveLength(2)
    expect(first.page.hasMore).toBe(true)
    expect(typeof first.page.nextCursor).toBe("string")

    const secondResponse = await app.request(
      `/v1/me/articles?limit=2&cursor=${encodeURIComponent(first.page.nextCursor!)}`
    )
    const second = (await secondResponse.json()) as {
      items: Array<{ id: string }>
      page: { hasMore: boolean; nextCursor?: string }
    }
    expect(second.items).toHaveLength(2)
    expect(second.page.hasMore).toBe(true)

    const overlap = first.items
      .map((item) => item.id)
      .filter((id) => second.items.some((item) => item.id === id))
    expect(overlap).toEqual([])

    store.close()
  })

  it("filters /v1/me/articles by q, state, feedIds, and sort", async () => {
    const store = openStore()
    const owner = "owner-1"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "a",
        title: "Weather update",
        url: "https://example.com/a",
        publishedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      },
      {
        externalId: "b",
        title: "Market report",
        url: "https://example.com/b",
        publishedAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
      },
    ])
    const app = createApp({ store, resolveOwner: async () => owner })

    const searched = await app.request("/v1/me/articles?q=Market")
    const searchedBody = (await searched.json()) as {
      items: Array<{ title: string }>
    }
    expect(searchedBody.items.map((item) => item.title)).toEqual([
      "Market report",
    ])

    const byFeed = await app.request(`/v1/me/articles?feedIds=${feed.id}`)
    const byFeedBody = (await byFeed.json()) as { items: unknown[] }
    expect(byFeedBody.items).toHaveLength(2)

    const oldest = await app.request("/v1/me/articles?sort=oldest")
    const oldestBody = (await oldest.json()) as {
      items: Array<{ title: string }>
    }
    expect(oldestBody.items[0]?.title).toBe("Weather update")

    store.close()
  })

  it("isolates /v1/me/articles by owner and rejects other owners' articles", async () => {
    const store = openStore()
    const owner = "owner-1"
    const otherOwner = "owner-2"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      {
        externalId: "a",
        title: "Owner-only article",
        url: "https://example.com/a",
      },
    ])
    const app = createApp({ store, resolveOwner: async () => otherOwner })

    const response = await app.request("/v1/me/articles")
    const body = (await response.json()) as { items: unknown[] }
    expect(body.items).toEqual([])

    store.close()
  })

  it("returns state and per-feed counts from /v1/me/articles/facets", async () => {
    const store = openStore()
    const owner = "owner-1"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      { externalId: "a", title: "First", url: "https://example.com/a" },
      { externalId: "b", title: "Second", url: "https://example.com/b" },
    ])
    const [firstArticle] = store.listArticles(owner).items
    store.setArticleState(owner, firstArticle!.id, { saved: true })
    const app = createApp({ store, resolveOwner: async () => owner })

    const response = await app.request("/v1/me/articles/facets")
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      states: { all: number; unread: number; saved: number }
      feeds: Array<{ feedId: string; name: string; count: number }>
    }
    expect(body.states).toEqual({ all: 2, unread: 2, saved: 1, later: 0 })
    expect(body.feeds).toEqual([{ feedId: feed.id, name: "Example", count: 2 }])

    store.close()
  })

  it("hides an article by default and includes it back with includeHidden=true", async () => {
    const store = openStore()
    const owner = "owner-1"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      { externalId: "a", title: "First", url: "https://example.com/a" },
      { externalId: "b", title: "Second", url: "https://example.com/b" },
    ])
    const app = createApp({ store, resolveOwner: async () => owner })
    const target = store.listArticles(owner).items[0]!

    const patched = await app.request(`/v1/me/articles/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    })
    expect(patched.status).toBe(200)
    const patchedBody = (await patched.json()) as {
      hidden: boolean
      hiddenAt?: string
    }
    expect(patchedBody.hidden).toBe(true)
    expect(typeof patchedBody.hiddenAt).toBe("string")

    const defaultList = await app.request("/v1/me/articles")
    const defaultBody = (await defaultList.json()) as { items: unknown[] }
    expect(defaultBody.items).toHaveLength(1)

    const includingHidden = await app.request(
      "/v1/me/articles?includeHidden=true"
    )
    const includingHiddenBody = (await includingHidden.json()) as {
      items: unknown[]
    }
    expect(includingHiddenBody.items).toHaveLength(2)

    store.close()
  })

  it("filters /v1/me/articles by state=later", async () => {
    const store = openStore()
    const owner = "owner-1"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      { externalId: "a", title: "First", url: "https://example.com/a" },
      { externalId: "b", title: "Second", url: "https://example.com/b" },
    ])
    const app = createApp({ store, resolveOwner: async () => owner })
    const target = store.listArticles(owner).items[0]!
    await app.request(`/v1/me/articles/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readLater: true }),
    })

    const response = await app.request("/v1/me/articles?state=later")
    const body = (await response.json()) as { items: Array<{ id: string }> }
    expect(body.items.map((item) => item.id)).toEqual([target.id])

    store.close()
  })

  it("applies bulk-state only to articles matching the filter, scoped to the owner", async () => {
    const store = openStore()
    const owner = "owner-1"
    const otherOwner = "owner-2"
    const { feed } = store.registerFeed({
      ownerId: owner,
      name: "Example",
      siteUrl: "https://example.com",
      feedUrl: "https://example.com/feed.xml",
    })
    store.upsertFeedItems(feed.id, [
      { externalId: "a", title: "First", url: "https://example.com/a" },
      { externalId: "b", title: "Second", url: "https://example.com/b" },
      { externalId: "c", title: "Third", url: "https://example.com/c" },
    ])
    const { feed: otherFeed } = store.registerFeed({
      ownerId: otherOwner,
      name: "Other",
      siteUrl: "https://other.example.com",
      feedUrl: "https://other.example.com/feed.xml",
    })
    store.upsertFeedItems(otherFeed.id, [
      {
        externalId: "z",
        title: "Other owner",
        url: "https://other.example.com/z",
      },
    ])
    const [firstArticle] = store.listArticles(owner).items
    store.setArticleState(owner, firstArticle!.id, { read: true })
    const app = createApp({ store, resolveOwner: async () => owner })

    const response = await app.request("/v1/me/articles/bulk-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "unread", read: true }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ updated: 2 })

    const allRead = store
      .listArticles(owner)
      .items.every((article) => article.read)
    expect(allRead).toBe(true)
    expect(
      store.listArticles(otherOwner).items.every((article) => !article.read)
    ).toBe(true)

    store.close()
  })

  it("rejects a bulk-state body with no state flags", async () => {
    const store = openStore()
    const app = createApp({ store, resolveOwner: async () => "owner-1" })

    const response = await app.request("/v1/me/articles/bulk-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "unread" }),
    })
    expect(response.status).toBe(400)

    store.close()
  })
})

function telemetryRequest(
  origin = "https://app.example.com",
  contentLength = 1
): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/x-protobuf",
      "Content-Length": String(contentLength),
      Origin: origin,
    },
    body: new Uint8Array([1]),
  }
}
