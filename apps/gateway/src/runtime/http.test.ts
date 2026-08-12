import { Effect, Layer, Schema, Tracer } from "effect"
import { describe, expect, it, vi } from "vitest"

import { FeedSubscriptionSchema } from "../contract.js"
import type { GatewayPorts } from "../ports.js"
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
  listEpisodes: () => Effect.fail(unavailable),
  createAudioAccess: () => Effect.fail(unavailable),
  addFeedSubscription: () => Effect.fail(unavailable),
  listFeedSubscriptions: () => Effect.fail(unavailable),
  deleteFeedSubscription: () => Effect.fail(unavailable),
}

describe("Gateway HTTP runtime", () => {
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
      subscriptionId: "9aa2225d-07e7-4af4-a8e6-e4788f801a91",
      feedId: "0c6bd9aa-f349-4c16-af84-acb845aa9d47",
      feedUrl: "https://feeds.example.com/news.xml",
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
          body: JSON.stringify({ feedUrl: subscription.feedUrl }),
        })
      )
      const listed = await runtime.handler(
        new Request("http://gateway.test/v1/me/feed-subscriptions")
      )
      const deleted = await runtime.handler(
        new Request(
          `http://gateway.test/v1/me/feed-subscriptions/${subscription.subscriptionId}`,
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
