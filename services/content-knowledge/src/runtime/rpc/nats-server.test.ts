import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import { runNatsContentKnowledgeRpc } from "./nats-server.js"

describe("Content Knowledge NATS RPC runtime", () => {
  it("owns the queue-group server and drains it at terminal completion", async () => {
    const drain = vi.fn(async () => undefined)
    const connect = vi.fn(async () => ({
      receive: vi.fn(async () => undefined),
      drain,
    }))
    const exit = await Effect.runPromiseExit(
      runNatsContentKnowledgeRpc(
        { natsServers: ["nats://127.0.0.1:4222"], queueGroup: "content-rpc" },
        {
          articles: {} as never,
          subscriptions: {} as never,
        },
        {} as never,
        {
          connect,
          newSubscriptionIdentity: vi.fn(),
          newMessageId: vi.fn(),
          now: vi.fn(),
        }
      )
    )

    expect(connect).toHaveBeenCalledWith(
      ["nats://127.0.0.1:4222"],
      [
        "content.add-subscription.v1",
        "content.list-subscriptions.v1",
        "content.delete-subscription.v1",
        "content.sync-subscription.v1",
        "content.update-subscription.v1",
        "content.list-feed-catalog.v1",
        "content.list-feed-sync-jobs.v1",
        "content.materialize-articles.v1",
        "content.article-library.v1",
        "content.personalization.v1",
      ],
      "content-rpc"
    )
    expect(drain).toHaveBeenCalledOnce()
    expect(exit._tag).toBe("Failure")
  })
})
