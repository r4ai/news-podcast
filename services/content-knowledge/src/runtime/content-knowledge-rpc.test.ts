import { deepFreeze } from "@news-podcast/kernel"
import { parseMessageEnvelope, subjects } from "@news-podcast/protocols"
import { Effect, Schema } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  CreatedAtSchema,
  FeedIdSchema,
  FeedUrlSchema,
  OwnerIdSchema,
  SubscriptionIdSchema,
} from "../domain/subscription.js"
import { makeContentKnowledgeRpcHandler } from "./content-knowledge-rpc.js"

const envelope = (
  payload: unknown,
  actor: unknown = { _tag: "User", userId: "owner-a" },
  producer = "gateway"
) =>
  JSON.stringify({
    messageId: "724fefb9-5ee4-4c02-a2a7-4ca923eed2a4",
    correlationId: "ea122752-73d0-4851-9664-7d3e63e76859",
    causationId: "8fb12955-2175-4675-be63-e42227d5ed19",
    occurredAt: "2026-08-13T01:00:00.000Z",
    producer,
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    actor,
    payload,
  })

const decodeReply = async (payload: string) =>
  Effect.runPromise(parseMessageEnvelope(JSON.parse(payload)))

describe("Content Knowledge RPC handler", () => {
  it("adds/lists/deletes with actor-derived owner and correlated replies", async () => {
    const subscription = deepFreeze({
      subscriptionId: Schema.decodeUnknownSync(SubscriptionIdSchema)(
        "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
      ),
      feedId: Schema.decodeUnknownSync(FeedIdSchema)(
        "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"
      ),
      ownerId: Schema.decodeUnknownSync(OwnerIdSchema)("owner-a"),
      feedUrl: Schema.decodeUnknownSync(FeedUrlSchema)(
        "https://feeds.example.com/news.xml"
      ),
      enabled: true,
      createdAt: Schema.decodeUnknownSync(CreatedAtSchema)(
        "2026-08-13T01:00:00.000Z"
      ),
    })
    const repository = {
      add: vi.fn(() =>
        Effect.succeed({ _tag: "Added", subscription } as const)
      ),
      list: vi.fn(() => Effect.succeed([subscription])),
      remove: vi.fn(() => Effect.succeed({ _tag: "Deleted" } as const)),
      listFeedsForPolling: vi.fn(),
      setEnabled: vi.fn(() =>
        Effect.succeed({
          _tag: "Updated" as const,
          subscription,
          enabled: false,
        })
      ),
      listCatalog: vi.fn(() =>
        Effect.succeed([
          { feedId: subscription.feedId, feedUrl: subscription.feedUrl },
        ])
      ),
    }
    const materialize = vi.fn(() =>
      Effect.succeed({ _tag: "NoArticles" } as const)
    )
    const enqueue = vi.fn(() => Effect.succeed({} as never))
    const onSubscriptionAdded = vi.fn()
    const handler = makeContentKnowledgeRpcHandler(
      repository,
      materialize,
      {
        newSubscriptionIdentity: () => ({
          subscriptionId: subscription.subscriptionId,
          feedId: subscription.feedId,
        }),
        newMessageId: () => "00508c91-8d8a-452f-82d3-fc621faea801",
        now: () => "2026-08-13T01:00:00.000Z",
        onSubscriptionAdded,
      },
      { enqueue } as never
    )

    const calls = [
      [subjects.content.addSubscription, { feedUrl: subscription.feedUrl }],
      [subjects.content.listSubscriptions, {}],
      [
        subjects.content.updateSubscription,
        { subscriptionId: subscription.subscriptionId, enabled: false },
      ],
      [subjects.content.listFeedCatalog, { q: "news" }],
      [
        subjects.content.deleteSubscription,
        { subscriptionId: subscription.subscriptionId },
      ],
    ] as const
    for (const [subject, request] of calls) {
      let output = ""
      await Effect.runPromise(
        handler({
          subject,
          payload: envelope(request),
          reply: (payload) =>
            Effect.sync(() => {
              output = payload
            }),
        })
      )
      const reply = await decodeReply(output)
      expect(reply.correlationId).toBe("ea122752-73d0-4851-9664-7d3e63e76859")
      expect(reply.causationId).toBe("724fefb9-5ee4-4c02-a2a7-4ca923eed2a4")
    }
    expect(repository.add).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "owner-a" })
    )
    expect(enqueue).toHaveBeenCalledWith(
      subscription.feedId,
      "2026-08-13T01:00:00.000Z"
    )
    expect(onSubscriptionAdded).toHaveBeenCalledOnce()
    expect(repository.list).toHaveBeenCalledWith("owner-a")
    expect(repository.remove).toHaveBeenCalledWith(
      "owner-a",
      subscription.subscriptionId
    )
    expect(repository.setEnabled).toHaveBeenCalledWith(
      "owner-a",
      subscription.subscriptionId,
      false
    )
    expect(repository.listCatalog).toHaveBeenCalledWith("owner-a", "news")
  })

  it("materializes for the actor owner and rejects anonymous or wrong producers", async () => {
    const repository = {
      add: vi.fn(),
      list: vi.fn(),
      remove: vi.fn(),
      listFeedsForPolling: vi.fn(),
    }
    const materialize = vi.fn(() =>
      Effect.succeed({ _tag: "NoArticles" } as const)
    )
    const handler = makeContentKnowledgeRpcHandler(
      repository as never,
      materialize,
      {
        newSubscriptionIdentity: vi.fn(),
        newMessageId: () => "00508c91-8d8a-452f-82d3-fc621faea801",
        now: () => "2026-08-13T01:00:00.000Z",
      }
    )
    let output = ""
    await Effect.runPromise(
      handler({
        subject: subjects.content.materializeArticles,
        payload: envelope(
          { selection: { _tag: "Automatic" } },
          undefined,
          "episode-production"
        ),
        reply: (payload) =>
          Effect.sync(() => {
            output = payload
          }),
      })
    )
    expect(materialize).toHaveBeenCalledWith({
      ownerId: "owner-a",
      selection: { _tag: "Automatic" },
    })
    expect((await decodeReply(output)).payload).toEqual({ _tag: "NoArticles" })

    for (const invalid of [
      envelope({}, { _tag: "Anonymous" }, "episode-production"),
      envelope(
        { selection: { _tag: "Automatic" } },
        undefined,
        "untrusted-client"
      ),
      "secret malformed payload",
    ]) {
      output = ""
      await Effect.runPromise(
        handler({
          subject: subjects.content.materializeArticles,
          payload: invalid,
          reply: (payload) =>
            Effect.sync(() => {
              output = payload
            }),
        })
      )
      expect(output).not.toContain("secret")
      const decoded = JSON.parse(output) as {
        readonly _tag?: string
        readonly payload?: { readonly _tag?: string }
      }
      expect(decoded.payload ?? decoded).toMatchObject({ _tag: "Rejected" })
    }
  })

  it("enqueues a manual sync for an owned enabled subscription", async () => {
    const subscription = deepFreeze({
      subscriptionId: Schema.decodeUnknownSync(SubscriptionIdSchema)(
        "9aa2225d-07e7-4af4-a8e6-e4788f801a91"
      ),
      feedId: Schema.decodeUnknownSync(FeedIdSchema)(
        "8d90a18a-7eb5-47bb-b6c1-1c9709b80cdd"
      ),
      ownerId: Schema.decodeUnknownSync(OwnerIdSchema)("owner-a"),
      feedUrl: Schema.decodeUnknownSync(FeedUrlSchema)(
        "https://feeds.example.com/news.xml"
      ),
      enabled: true,
      createdAt: Schema.decodeUnknownSync(CreatedAtSchema)(
        "2026-08-13T01:00:00.000Z"
      ),
    })
    const repository = {
      list: vi.fn(() => Effect.succeed([subscription])),
    }
    const job = deepFreeze({
      jobId: "6e9f7a7c-0d1d-47b1-9b0b-0f2f95c45d1d",
      feedId: subscription.feedId,
      feedUrl: subscription.feedUrl,
      status: "Queued" as const,
      attempt: 0,
      maxAttempts: 4 as const,
      discovered: 0,
      archived: 0,
      failed: 0,
      createdAt: "2026-08-13T01:00:00.000Z",
    })
    const enqueue = vi.fn(() => Effect.succeed(job))
    const handler = makeContentKnowledgeRpcHandler(
      repository as never,
      vi.fn(() => Effect.succeed({ _tag: "NoArticles" } as const)),
      {
        newSubscriptionIdentity: vi.fn(),
        newMessageId: () => "00508c91-8d8a-452f-82d3-fc621faea801",
        now: () => "2026-08-13T01:00:00.000Z",
      },
      { enqueue } as never
    )
    let output = ""

    await Effect.runPromise(
      handler({
        subject: "content.sync-subscription.v1",
        payload: envelope({
          subscriptionId: subscription.subscriptionId,
        }),
        reply: (payload) =>
          Effect.sync(() => {
            output = payload
          }),
      })
    )

    expect(enqueue).toHaveBeenCalledWith(
      subscription.feedId,
      "2026-08-13T01:00:00.000Z"
    )
    expect((await decodeReply(output)).payload).toMatchObject({
      _tag: "Synced",
      job,
    })
  })
})
