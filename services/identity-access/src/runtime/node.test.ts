import {
  parseMessageEnvelope,
  parseResolveSessionReply,
} from "@news-podcast/protocols"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { BetterAuthSessionApi } from "../adapters/better-auth-session-reader.js"
import type { UnsafeNatsRpcServer } from "../infrastructure/unsafe/nats-rpc.js"
import {
  parseNodeResolveSessionRpcConfig,
  runNodeResolveSessionRpc,
} from "./node.js"

const config = {
  natsServers: ["nats://127.0.0.1:4222"],
  queueGroup: "identity-access",
}
const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

const request = (messageId: string, cookie: string) =>
  JSON.stringify({
    messageId,
    correlationId: "f8f15e30-6877-4b4d-9568-76bfa3dc3e40",
    causationId: "3c4d046c-b47b-4047-a562-66ac7e74e995",
    occurredAt: "2026-08-12T00:00:00.000Z",
    producer: "gateway",
    traceparent,
    actor: { _tag: "Anonymous" },
    payload: { headers: [{ name: "cookie", value: cookie }] },
  })

const dependencies = (server: UnsafeNatsRpcServer) => {
  const replyIds = [
    "5af55f2e-ff0b-475c-866a-f2cff48c101d",
    "6518412b-ce2f-4641-9f2c-a02dd515bc31",
  ]
  return {
    connectNats: vi.fn(async () => server),
    newMessageId: () => replyIds.shift()!,
    now: () => "2026-08-12T00:00:01.000Z",
  }
}

describe("identity-access Node RPC runtime", () => {
  it("parses and freezes configuration before acquiring NATS", async () => {
    const parsed = await Effect.runPromise(
      parseNodeResolveSessionRpcConfig(config)
    )

    expect(parsed).toEqual(config)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.natsServers)).toBe(true)
  })

  it.each([
    ["wrong server scheme", { ...config, natsServers: ["https://nats.test"] }],
    ["empty server list", { ...config, natsServers: [] }],
    ["invalid queue group", { ...config, queueGroup: "Identity Access" }],
    ["unknown property", { ...config, debug: true }],
  ])("rejects %s before connecting", async (_case, input) => {
    const connectNats = vi.fn()
    const exit = await Effect.runPromiseExit(
      runNodeResolveSessionRpc(
        input,
        { getSession: () => Promise.resolve(null) },
        {
          connectNats,
          newMessageId: () => "unused",
          now: () => "unused",
        }
      )
    )

    expect(exit._tag).toBe("Failure")
    expect(connectNats).not.toHaveBeenCalled()
  })

  it("processes deliveries sequentially and drains NATS on completion", async () => {
    const events: string[] = []
    const replies: string[] = []
    const pending = [
      request("7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80", "session=one"),
      request("10e2d4e1-c127-479f-a124-2ea037bd9319", "session=two"),
    ]
    const drain = vi.fn(async () => void events.push("drain"))
    const server: UnsafeNatsRpcServer = {
      receive: async () => {
        const payload = pending.shift()
        if (payload === undefined) return undefined
        events.push(`receive:${pending.length}`)
        return {
          payload,
          reply: async (reply) => {
            events.push(`reply:${pending.length}`)
            replies.push(reply)
          },
        }
      },
      drain,
    }
    let active = 0
    let maximumActive = 0
    const api: BetterAuthSessionApi = {
      getSession: async ({ headers }) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        events.push(`session:${headers.get("cookie")}`)
        await Promise.resolve()
        active -= 1
        return {
          user: { id: "better-auth-user_01" },
        }
      },
    }

    await Effect.runPromise(
      runNodeResolveSessionRpc(config, api, dependencies(server))
    )

    expect(maximumActive).toBe(1)
    expect(events).toEqual([
      "receive:1",
      "session:session=one",
      "reply:1",
      "receive:0",
      "session:session=two",
      "reply:0",
      "drain",
    ])
    expect(drain).toHaveBeenCalledOnce()
    expect(replies).toHaveLength(2)
  })

  it("keeps consuming after a provider rejection", async () => {
    const replies: string[] = []
    const pending = [
      request("7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80", "session=fail"),
      request("10e2d4e1-c127-479f-a124-2ea037bd9319", "session=ok"),
    ]
    const server: UnsafeNatsRpcServer = {
      receive: async () => {
        const payload = pending.shift()
        return payload === undefined
          ? undefined
          : { payload, reply: async (reply) => void replies.push(reply) }
      },
      drain: async () => undefined,
    }
    const api: BetterAuthSessionApi = {
      getSession: ({ headers }) =>
        headers.get("cookie") === "session=fail"
          ? Promise.reject(new Error("provider unavailable"))
          : Promise.resolve(null),
    }

    await Effect.runPromise(
      runNodeResolveSessionRpc(config, api, dependencies(server))
    )

    const payloads = await Promise.all(
      replies.map(async (reply) => {
        const envelope = await Effect.runPromise(
          parseMessageEnvelope(JSON.parse(reply) as unknown)
        )
        return Effect.runPromise(parseResolveSessionReply(envelope.payload))
      })
    )
    expect(payloads).toEqual([
      { _tag: "Rejected", code: "SESSION_PROVIDER_FAILURE" },
      { actor: { _tag: "Anonymous" } },
    ])
  })

  it("drains NATS when replying fails", async () => {
    const drain = vi.fn(async () => undefined)
    let delivered = false
    const server: UnsafeNatsRpcServer = {
      receive: async () => {
        if (delivered) return undefined
        delivered = true
        return {
          payload: request(
            "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
            "session=opaque"
          ),
          reply: () => Promise.reject(new Error("reply failed")),
        }
      },
      drain,
    }

    const exit = await Effect.runPromiseExit(
      runNodeResolveSessionRpc(
        config,
        { getSession: () => Promise.resolve(null) },
        dependencies(server)
      )
    )

    expect(exit._tag).toBe("Failure")
    expect(drain).toHaveBeenCalledOnce()
  })

  it("drains NATS when reply-envelope dependencies violate the protocol", async () => {
    const drain = vi.fn(async () => undefined)
    let delivered = false
    const server: UnsafeNatsRpcServer = {
      receive: async () => {
        if (delivered) return undefined
        delivered = true
        return {
          payload: request(
            "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
            "session=opaque"
          ),
          reply: async () => undefined,
        }
      },
      drain,
    }

    const exit = await Effect.runPromiseExit(
      runNodeResolveSessionRpc(
        config,
        { getSession: () => Promise.resolve(null) },
        {
          connectNats: async () => server,
          newMessageId: () => "not-a-message-id",
          now: () => "2026-08-12T00:00:01.000Z",
        }
      )
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("Handler")
    }
    expect(drain).toHaveBeenCalledOnce()
  })

  it("classifies receive failures as NATS errors and drains the connection", async () => {
    const drain = vi.fn(async () => undefined)
    const server: UnsafeNatsRpcServer = {
      receive: () => Promise.reject(new Error("subscription closed")),
      drain,
    }

    const exit = await Effect.runPromiseExit(
      runNodeResolveSessionRpc(
        config,
        { getSession: () => Promise.resolve(null) },
        dependencies(server)
      )
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("Nats")
    }
    expect(drain).toHaveBeenCalledOnce()
  })

  it("reports NATS acquisition failures without calling Better Auth", async () => {
    const api = { getSession: vi.fn() }
    const exit = await Effect.runPromiseExit(
      runNodeResolveSessionRpc(config, api, {
        connectNats: () => Promise.reject(new Error("connection refused")),
        newMessageId: () => "unused",
        now: () => "unused",
      })
    )

    expect(exit._tag).toBe("Failure")
    expect(api.getSession).not.toHaveBeenCalled()
  })
})
