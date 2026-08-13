import { Effect, Fiber } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { UnsafeNatsRequestClient } from "../infrastructure/unsafe/nats-request.js"
import {
  parseNodeGatewayConfig,
  runNodeGateway,
  type UnsafeGatewayHttpServer,
} from "./node.js"

const validConfig = {
  hostname: "0.0.0.0",
  port: 4100,
  natsServers: ["nats://nats:4222"],
  requestTimeoutMillis: 2_000,
  loginMethods: { development: true, google: false },
  identityHttpOrigin: "http://identity-access:4002",
  authProxyTimeoutMillis: 5_000,
  authProxyMaximumResponseBytes: 1_048_576,
}

describe("Gateway Node runtime", () => {
  it("rejects invalid external configuration before acquiring resources", async () => {
    const failure = await Effect.runPromise(
      parseNodeGatewayConfig({ ...validConfig, port: 70_000 }).pipe(Effect.flip)
    )

    expect(failure).toBeDefined()
  })

  it("serves the API and drains HTTP then NATS when interrupted", async () => {
    const events: string[] = []
    let handler: ((request: Request) => Promise<Response>) | undefined
    const client: UnsafeNatsRequestClient = {
      request: async () => {
        throw new Error("unused")
      },
      drain: async () => {
        events.push("nats.drained")
      },
    }
    const server: UnsafeGatewayHttpServer = {
      close: async () => {
        events.push("http.closed")
      },
    }
    let resolveListening!: () => void
    const listening = new Promise<void>((resolve) => {
      resolveListening = resolve
    })

    const fiber = Effect.runFork(
      runNodeGateway(validConfig, {
        connectNats: async (servers) => {
          events.push(`nats.connected:${servers.join(",")}`)
          return client
        },
        listen: async (input) => {
          handler = input.handler
          events.push(`http.listening:${input.hostname}:${input.port}`)
          resolveListening()
          return server
        },
        nextMessageId: () => "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
        now: () => "2026-08-13T00:00:00.000Z",
      })
    )

    await listening
    const response = await handler!(new Request("http://gateway.test/health"))
    expect(await response.json()).toEqual({ status: "ok" })

    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(events).toEqual([
      "nats.connected:nats://nats:4222",
      "http.listening:0.0.0.0:4100",
      "http.closed",
      "nats.drained",
    ])
  })

  it("maps an HTTP bind failure without leaking the NATS connection", async () => {
    const drain = vi.fn(async () => undefined)
    const failure = await Effect.runPromise(
      runNodeGateway(validConfig, {
        connectNats: async () => ({
          request: async () => new Uint8Array(),
          drain,
        }),
        listen: async () => Promise.reject(new Error("EADDRINUSE")),
        nextMessageId: () => "7f52766d-3b0b-4ca9-b5e8-7bfd35dc3a80",
        now: () => "2026-08-13T00:00:00.000Z",
      }).pipe(Effect.flip)
    )

    expect(failure).toEqual({
      _tag: "GatewayRuntimeFailed",
      component: "Http",
    })
    expect(drain).toHaveBeenCalledOnce()
  })
})
