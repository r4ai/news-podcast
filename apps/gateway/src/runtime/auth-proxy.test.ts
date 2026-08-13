import { describe, expect, it, vi } from "vitest"

import { makeGatewayAuthProxy } from "./auth-proxy.js"

describe("Gateway auth proxy", () => {
  it("keeps the canonical auth state route in Gateway after dev login", async () => {
    const next = vi.fn(async (request: Request) =>
      Response.json({ authenticated: request.headers.has("cookie") })
    )
    const proxy = makeGatewayAuthProxy({
      upstream: new URL("http://identity:4002"),
      timeoutMillis: 100,
      maximumResponseBytes: 1024,
      fetch: vi.fn(
        async () =>
          new Response(null, {
            headers: { "set-cookie": "session=opaque; HttpOnly" },
          })
      ) as never,
      next,
    })
    const login = await proxy(
      new Request("http://gateway/api/dev/login", { method: "POST" })
    )
    const state = await proxy(
      new Request("http://gateway/api/auth/state", {
        headers: { cookie: login.headers.get("set-cookie")! },
      })
    )
    expect(await state.json()).toEqual({ authenticated: true })
    expect(next).toHaveBeenCalledOnce()
  })

  it("uses only the configured upstream and preserves cookies and redirects", async () => {
    const fetch = vi.fn(
      async (_url: URL) =>
        new Response(null, {
          status: 302,
          headers: {
            location: "/callback",
            "set-cookie": "session=opaque; HttpOnly",
            connection: "close",
          },
        })
    )
    const proxy = makeGatewayAuthProxy({
      upstream: new URL("http://identity:4002"),
      timeoutMillis: 100,
      maximumResponseBytes: 1024,
      fetch: fetch as never,
      next: vi.fn(),
    })
    const response = await proxy(
      new Request(
        "http://attacker.example/api/auth/sign-in?next=https://evil.test",
        { method: "POST" }
      )
    )
    expect(fetch.mock.calls[0]![0].origin).toBe("http://identity:4002")
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("/callback")
    expect(response.headers.get("set-cookie")).toContain("session=opaque")
    expect(response.headers.has("connection")).toBe(false)
  })

  it("leaves non-auth routes to the Gateway and bounds upstream responses", async () => {
    const next = vi.fn(async () => new Response("gateway"))
    const fetch = vi.fn(
      async () =>
        new Response("too large", { headers: { "content-length": "9999" } })
    )
    const proxy = makeGatewayAuthProxy({
      upstream: new URL("http://identity:4002"),
      timeoutMillis: 100,
      maximumResponseBytes: 8,
      fetch: fetch as never,
      next,
    })
    expect(
      await (await proxy(new Request("http://gateway/health"))).text()
    ).toBe("gateway")
    expect(
      (
        await proxy(
          new Request("http://gateway/api/dev/login", { method: "POST" })
        )
      ).status
    ).toBe(502)
  })

  it("cancels a chunked request as soon as it exceeds the limit", async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6))
        controller.enqueue(new Uint8Array(6))
      },
      cancel,
    })
    const fetch = vi.fn()
    const proxy = makeGatewayAuthProxy({
      upstream: new URL("http://identity:4002"),
      timeoutMillis: 100,
      maximumResponseBytes: 8,
      fetch,
      next: vi.fn(),
    })
    const response = await proxy(
      new Request("http://gateway/api/dev/login", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit)
    )
    expect(response.status).toBe(413)
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("cancels a stalled chunked request at the deadline", async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel,
    })
    const proxy = makeGatewayAuthProxy({
      upstream: new URL("http://identity:4002"),
      timeoutMillis: 10,
      maximumResponseBytes: 8,
      fetch: vi.fn(),
      next: vi.fn(),
    })
    expect(
      (
        await proxy(
          new Request("http://gateway/api/dev/login", {
            method: "POST",
            body: stream,
            duplex: "half",
          } as RequestInit)
        )
      ).status
    ).toBe(503)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("rejects a stated oversized request before contacting Identity", async () => {
    const fetch = vi.fn()
    const proxy = makeGatewayAuthProxy({
      upstream: new URL("http://identity:4002"),
      timeoutMillis: 100,
      maximumResponseBytes: 8,
      fetch,
      next: vi.fn(),
    })

    const response = await proxy(
      new Request("http://gateway/api/dev/login", {
        method: "POST",
        headers: { "content-length": "9" },
        body: "password=ignored",
      })
    )

    expect(response.status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("cancels an unstated oversized upstream response", async () => {
    const cancel = vi.fn()
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6))
        controller.enqueue(new Uint8Array(6))
      },
      cancel,
    })
    const proxy = makeGatewayAuthProxy({
      upstream: new URL("http://identity:4002"),
      timeoutMillis: 100,
      maximumResponseBytes: 8,
      fetch: vi.fn(async () => new Response(responseBody)) as never,
      next: vi.fn(),
    })

    const response = await proxy(
      new Request("http://gateway/api/auth/callback")
    )

    expect(response.status).toBe(502)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("maps an upstream transport failure to a fixed unavailable response", async () => {
    const proxy = makeGatewayAuthProxy({
      upstream: new URL("http://identity:4002"),
      timeoutMillis: 100,
      maximumResponseBytes: 8,
      fetch: vi.fn(async () => {
        throw new Error("private upstream detail")
      }) as never,
      next: vi.fn(),
    })

    const response = await proxy(
      new Request("http://gateway/api/auth/callback", { method: "HEAD" })
    )

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("private upstream detail")
  })

  it("forwards an empty successful auth response without inventing a body", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    const proxy = makeGatewayAuthProxy({
      upstream: new URL("http://identity:4002"),
      timeoutMillis: 100,
      maximumResponseBytes: 8,
      fetch: fetch as never,
      next: vi.fn(),
    })

    const response = await proxy(
      new Request("http://gateway/api/auth/sign-out")
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")
    expect(fetch).toHaveBeenCalledOnce()
  })
})
