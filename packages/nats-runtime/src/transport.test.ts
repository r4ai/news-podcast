import { connect } from "@nats-io/transport-node"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { connectNatsRpc } from "./transport.js"

vi.mock("@nats-io/transport-node", () => ({ connect: vi.fn() }))

const pending = () => new Promise<never>(() => undefined)
const pendingStatuses = () => ({
  [Symbol.asyncIterator]: () => ({ next: pending }),
})

const oneMessageSubscription = (respond: (payload: string) => boolean) => {
  let delivered = false
  let finish: (() => void) | undefined
  return {
    subscription: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (!delivered) {
            delivered = true
            return Promise.resolve({
              done: false as const,
              value: {
                subject: "rpc.subject",
                data: new TextEncoder().encode("request"),
                respond,
              },
            })
          }
          return new Promise<{ done: true; value: undefined }>((resolve) => {
            finish = () => resolve({ done: true, value: undefined })
          })
        },
      }),
    },
    finish: () => finish?.(),
  }
}

describe("shared NATS RPC transport", () => {
  beforeEach(() => vi.clearAllMocks())

  it("decodes one delivery, replies, drains, and surfaces subscription end", async () => {
    const respond = vi.fn(() => true)
    const stream = oneMessageSubscription(respond)
    const drain = vi.fn(async () => undefined)
    const subscribe = vi.fn(() => stream.subscription)
    vi.mocked(connect).mockResolvedValue({
      subscribe,
      drain,
      closed: pending,
      status: pendingStatuses,
    } as never)

    const server = await connectNatsRpc(
      ["nats://one:4222"],
      "rpc.subject",
      "workers"
    )
    const delivery = await server.receive()
    if (delivery === undefined) throw new Error("expected delivery")

    expect(connect).toHaveBeenCalledWith({
      servers: ["nats://one:4222"],
      reconnect: false,
    })
    expect(subscribe).toHaveBeenCalledWith("rpc.subject", { queue: "workers" })
    expect(delivery).toMatchObject({
      subject: "rpc.subject",
      payload: "request",
    })
    await delivery.reply("response")
    expect(respond).toHaveBeenCalledWith("response")
    stream.finish()
    await expect(server.receive()).rejects.toThrow("NATS subscription ended")
    await server.drain()
    expect(drain).toHaveBeenCalledOnce()
  })

  it("rejects a reply when the request has no reply subject", async () => {
    const stream = oneMessageSubscription(() => false)
    vi.mocked(connect).mockResolvedValue({
      subscribe: () => stream.subscription,
      drain: async () => undefined,
      closed: pending,
      status: pendingStatuses,
    } as never)
    const server = await connectNatsRpc(
      ["nats://one:4222"],
      "rpc.subject",
      "workers"
    )

    const delivery = await server.receive()
    if (delivery === undefined) throw new Error("expected delivery")
    await expect(delivery.reply("response")).rejects.toThrow(
      "NATS request has no reply subject"
    )
  })

  it("surfaces the first receive failure across multiple subscriptions", async () => {
    const receiveFailure = new Error("receive failed")
    vi.mocked(connect).mockResolvedValue({
      subscribe: (subject: string) => ({
        [Symbol.asyncIterator]: () => ({
          next: () =>
            subject === "failed.subject"
              ? Promise.reject(receiveFailure)
              : pending(),
        }),
      }),
      drain: async () => undefined,
      closed: pending,
      status: pendingStatuses,
    } as never)
    const server = await connectNatsRpc(
      ["nats://one:4222"],
      ["waiting.subject", "failed.subject"],
      "workers"
    )

    await expect(server.receive()).rejects.toBe(receiveFailure)
  })

  it.each([
    [new Error("socket closed"), "socket closed"],
    [undefined, "NATS connection closed without a reason"],
  ])("surfaces connection closure %#", async (failure, message) => {
    vi.mocked(connect).mockResolvedValue({
      subscribe: vi.fn(),
      drain: async () => undefined,
      closed: () => Promise.resolve(failure),
      status: pendingStatuses,
    } as never)
    const server = await connectNatsRpc(["nats://one:4222"], [], "workers")

    await expect(server.receive()).rejects.toThrow(message)
  })

  it("drains a partially acquired connection and preserves setup failure", async () => {
    const drain = vi.fn(async () => {
      throw new Error("drain failed")
    })
    vi.mocked(connect).mockResolvedValue({
      subscribe: () => {
        throw new Error("subscription failed")
      },
      drain,
      closed: pending,
      status: pendingStatuses,
    } as never)

    await expect(
      connectNatsRpc(["nats://one:4222"], "rpc.subject", "workers")
    ).rejects.toThrow("subscription failed")
    expect(drain).toHaveBeenCalledOnce()
  })

  it("treats the first connection disconnect as terminal", async () => {
    vi.mocked(connect).mockResolvedValue({
      subscribe: vi.fn(),
      drain: async () => undefined,
      closed: pending,
      status: async function* () {
        yield { type: "reconnecting" }
        yield { type: "disconnect", server: "nats://one:4222" }
      },
    } as never)
    const server = await connectNatsRpc(["nats://one:4222"], [], "workers")

    await expect(server.receive()).rejects.toThrow(
      "NATS connection disconnected: nats://one:4222"
    )
  })
})
