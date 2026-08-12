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

describe("Content article materializer", () => {
  it("sends owner scope only as a User actor and parses strict articles", async () => {
    const request = vi.fn(
      async (_subject: string, _payload: Uint8Array, _timeout: number) =>
        new TextEncoder().encode(
          JSON.stringify({ _tag: "Materialized", articles: [article] })
        )
    )
    const materializer = makeContentArticleMaterializer(
      { request, close: async () => undefined },
      {
        newMessageId: () => "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
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
    const envelope = JSON.parse(new TextDecoder().decode(request.mock.calls[0]![1]))
    expect(envelope.actor).toEqual({ _tag: "User", userId: "owner-1" })
    expect(envelope.payload).not.toHaveProperty("ownerId")
  })

  it("maps empty and transport failures to typed pipeline failures", async () => {
    const empty = makeContentArticleMaterializer(
      {
        request: async () => new TextEncoder().encode('{"_tag":"NoArticles"}'),
        close: async () => undefined,
      },
      { newMessageId: () => crypto.randomUUID(), now: () => "2026-08-13T00:00:00.000Z", timeoutMillis: 1 },
    )
    const exit = await Effect.runPromiseExit(
      empty.materialize({ ownerId: "owner-1" as never, selection: { _tag: "Automatic" } })
    )
    expect(exit._tag).toBe("Failure")
  })
})
