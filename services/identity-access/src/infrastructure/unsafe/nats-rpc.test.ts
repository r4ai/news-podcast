import { connect } from "@nats-io/transport-node"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { connectNatsRpcUnsafe } from "./nats-rpc.js"

vi.mock("@nats-io/transport-node", () => ({ connect: vi.fn() }))

describe("unsafe NATS RPC transport", () => {
  beforeEach(() => vi.clearAllMocks())

  it("subscribes with a queue, decodes deliveries, replies, and drains", async () => {
    const respond = vi.fn(() => true)
    const messages = [
      {
        done: false as const,
        value: { data: new TextEncoder().encode("request"), respond },
      },
      { done: true as const, value: undefined },
    ]
    const drain = vi.fn(async () => undefined)
    const subscribe = vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: async () => messages.shift()! }),
    }))
    vi.mocked(connect).mockResolvedValue({ subscribe, drain } as never)

    const server = await connectNatsRpcUnsafe(
      ["nats://one:4222"],
      "identity.resolve-session.v1",
      "identity-access"
    )
    const delivery = await server.receive()

    expect(connect).toHaveBeenCalledWith({ servers: ["nats://one:4222"] })
    expect(subscribe).toHaveBeenCalledWith("identity.resolve-session.v1", {
      queue: "identity-access",
    })
    expect(delivery?.payload).toBe("request")
    await delivery?.reply("response")
    expect(respond).toHaveBeenCalledWith("response")
    expect(await server.receive()).toBeUndefined()
    await server.drain()
    expect(drain).toHaveBeenCalledOnce()
  })

  it("rejects replies when the request has no reply subject", async () => {
    vi.mocked(connect).mockResolvedValue({
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({
            done: false,
            value: {
              data: new Uint8Array(),
              respond: () => false,
            },
          }),
        }),
      }),
      drain: async () => undefined,
    } as never)
    const server = await connectNatsRpcUnsafe(
      ["nats://one:4222"],
      "identity.resolve-session.v1",
      "identity-access"
    )

    const delivery = await server.receive()

    await expect(delivery?.reply("response")).rejects.toThrow(
      "NATS request has no reply subject"
    )
  })

  it("drains a partially acquired connection when subscription setup fails", async () => {
    const drain = vi.fn(async () => undefined)
    vi.mocked(connect).mockResolvedValue({
      subscribe: () => {
        throw new Error("subscription failed")
      },
      drain,
    } as never)

    await expect(
      connectNatsRpcUnsafe(
        ["nats://one:4222"],
        "identity.resolve-session.v1",
        "identity-access"
      )
    ).rejects.toThrow("subscription failed")
    expect(drain).toHaveBeenCalledOnce()
  })
})
