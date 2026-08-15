import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import { makeContentArticleMaterializer } from "./content-article-materializer.js"
import { OwnerIdSchema } from "../domain/episode-job.js"

const article = {
  articleId: "f8f15e30-6877-4b4d-9568-76bfa3dc3a40",
  snapshotId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
  title: "News",
  url: "https://example.com/news",
  markdown: "Verified article",
}

const requestMessageId = "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80"
const replyEnvelope = (payload: unknown, correlationId = requestMessageId) =>
  JSON.stringify({
    messageId: "00508c91-8d8a-452f-82d3-fc621faea801",
    correlationId,
    causationId: requestMessageId,
    occurredAt: "2026-08-13T00:00:01.000Z",
    producer: "content-knowledge",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    actor: { _tag: "Service", service: "content-knowledge" },
    payload,
  })
describe("Content article materializer", () => {
  it("sends owner scope only as a User actor and parses strict articles", async () => {
    const request = vi.fn(
      async (_subject: string, _payload: Uint8Array, _timeout: number) =>
        new TextEncoder().encode(
          replyEnvelope({ _tag: "Materialized", articles: [article] })
        )
    )
    const materializer = makeContentArticleMaterializer(
      { request, close: async () => undefined },
      {
        newMessageId: () => requestMessageId,
        now: () => "2026-08-13T00:00:00.000Z",
        timeoutMillis: 2_000,
      }
    )
    const result = await Effect.runPromise(
      materializer.materialize({
        ownerId: Schema.decodeUnknownSync(OwnerIdSchema)("owner-1"),
        selection: { _tag: "Automatic" },
      })
    )
    expect(result).toEqual([article])
    const envelope = JSON.parse(
      new TextDecoder().decode(request.mock.calls[0]![1])
    )
    expect(envelope.actor).toEqual({ _tag: "User", userId: "owner-1" })
    expect(envelope.payload).not.toHaveProperty("ownerId")
  })

  it("maps an empty reply to a terminal pipeline failure", async () => {
    const empty = makeContentArticleMaterializer(
      {
        request: async () =>
          new TextEncoder().encode(replyEnvelope({ _tag: "NoArticles" })),
        close: async () => undefined,
      },
      {
        newMessageId: () => requestMessageId,
        now: () => "2026-08-13T00:00:00.000Z",
        timeoutMillis: 1,
      }
    )
    const failure = await Effect.runPromise(
      Effect.flip(
        empty.materialize({
          ownerId: "owner-1" as never,
          selection: { _tag: "Automatic" },
        })
      )
    )
    expect(failure).toMatchObject({
      code: "content_materialization_empty",
      retryable: false,
    })
  })

  it.each([
    {
      name: "transport failure",
      request: async () => Promise.reject(new Error("NATS unavailable")),
      expected: {
        code: "content_materialization_unavailable",
        retryable: true,
      },
    },
    {
      name: "malformed JSON",
      request: async () => new TextEncoder().encode("not JSON"),
      expected: {
        code: "content_materialization_invalid",
        retryable: false,
      },
    },
  ])(
    "maps $name to a typed pipeline failure",
    async ({ request, expected }) => {
      const materializer = makeContentArticleMaterializer(
        { request, close: async () => undefined },
        {
          newMessageId: () => requestMessageId,
          now: () => "2026-08-13T00:00:00.000Z",
          timeoutMillis: 2_000,
        }
      )

      const failure = await Effect.runPromise(
        Effect.flip(
          materializer.materialize({
            ownerId: "owner-1" as never,
            selection: { _tag: "Automatic" },
          })
        )
      )

      expect(failure).toMatchObject(expected)
    }
  )

  it("rejects a response correlated to another request", async () => {
    const materializer = makeContentArticleMaterializer(
      {
        request: async () =>
          new TextEncoder().encode(
            replyEnvelope(
              { _tag: "Materialized", articles: [article] },
              "10e2d4e1-c127-479f-a124-2ea037bd9319"
            )
          ),
        close: async () => undefined,
      },
      {
        newMessageId: () => requestMessageId,
        now: () => "2026-08-13T00:00:00.000Z",
        timeoutMillis: 2_000,
      }
    )

    const failure = await Effect.runPromise(
      Effect.flip(
        materializer.materialize({
          ownerId: "owner-1" as never,
          selection: { _tag: "Automatic" },
        })
      )
    )

    expect(failure).toMatchObject({
      code: "content_materialization_invalid",
      retryable: false,
    })
  })
})
