import { describe, expect, it } from "vitest"
import {
  noopObservability,
  type Observability,
  type SpanOptions,
} from "@news-podcast/observability"

import { createApp } from "./app.js"

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
