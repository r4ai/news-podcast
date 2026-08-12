import { deepFreeze } from "@news-podcast/kernel"
import { MessageEnvelopeSchema, subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import { makeArticleLibraryRpcHandler } from "./article-library-rpc.js"

const articleId = "5af55f2e-ff0b-475c-866a-f2cff48c101d"
const ownerId = "owner-1"
const request = (
  payload: unknown,
  actor: unknown = { _tag: "User", userId: ownerId }
) =>
  JSON.stringify({
    messageId: "123e4567-e89b-42d3-a456-426614174000",
    correlationId: "123e4567-e89b-42d3-a456-426614174001",
    causationId: "123e4567-e89b-42d3-a456-426614174002",
    occurredAt: "2026-08-13T00:00:00.000Z",
    producer: "gateway",
    traceparent: "00-123e4567e89b42d3a456426614174000-123e4567e89b42d3-01",
    actor,
    payload,
  })

const dependencies = {
  newMessageId: () => "123e4567-e89b-42d3-a456-426614174009",
  now: () => "2026-08-13T00:00:01.000Z",
}

describe("article library RPC handler", () => {
  it("derives the owner only from the user actor and correlates the reply", async () => {
    const find = vi.fn(() =>
      Effect.succeed(deepFreeze({ _tag: "NotFound" as const }))
    )
    const reply = vi.fn((_payload: string) => Effect.void)
    const handler = makeArticleLibraryRpcHandler(
      { find } as never,
      dependencies
    )
    await Effect.runPromise(
      handler({
        subject: subjects.content.articleLibrary,
        payload: request({ operation: "Find", articleId }),
        reply,
      })
    )

    expect(find).toHaveBeenCalledWith({ ownerId, articleId })
    const envelope = Schema.decodeUnknownSync(MessageEnvelopeSchema)(
      JSON.parse(reply.mock.calls[0]![0] as string)
    )
    expect(envelope).toMatchObject({
      correlationId: "123e4567-e89b-42d3-a456-426614174001",
      causationId: "123e4567-e89b-42d3-a456-426614174000",
      producer: "content-knowledge",
      payload: { _tag: "NotFound" },
    })
  })

  it("rejects service actors without invoking the library", async () => {
    const find = vi.fn(() => Effect.die("must not run"))
    const reply = vi.fn((_payload: string) => Effect.void)
    await Effect.runPromise(
      makeArticleLibraryRpcHandler(
        { find } as never,
        dependencies
      )({
        subject: subjects.content.articleLibrary,
        payload: request(
          { operation: "Find", articleId },
          { _tag: "Service", service: "gateway" }
        ),
        reply,
      })
    )
    expect(find).not.toHaveBeenCalled()
    expect(JSON.parse(reply.mock.calls[0]![0] as string).payload).toEqual({
      _tag: "Rejected",
      code: "UNAUTHENTICATED",
    })
  })

  it("returns only a raw rejection when no request envelope can be trusted", async () => {
    const reply = vi.fn((_payload: string) => Effect.void)
    await Effect.runPromise(
      makeArticleLibraryRpcHandler(
        {} as never,
        dependencies
      )({
        subject: subjects.content.articleLibrary,
        payload: "not-json",
        reply,
      })
    )
    expect(JSON.parse(reply.mock.calls[0]![0] as string)).toEqual({
      _tag: "Rejected",
      code: "INVALID_REQUEST",
    })
  })

  it("correlates strict payload rejection as an invalid request", async () => {
    const reply = vi.fn((_payload: string) => Effect.void)
    await Effect.runPromise(
      makeArticleLibraryRpcHandler(
        {} as never,
        dependencies
      )({
        subject: subjects.content.articleLibrary,
        payload: request({ operation: "Find", articleId, ownerId: "victim" }),
        reply,
      })
    )
    expect(JSON.parse(reply.mock.calls[0]![0]).payload).toEqual({
      _tag: "Rejected",
      code: "INVALID_REQUEST",
    })
  })
})
