import { describe, expect, it, vi } from "vitest"

import { makeIdentityAuthHttpHandler } from "./auth-http.js"

const input = () => ({
  betterAuthHandler: vi.fn(async () =>
    Response.json(
      { better: true },
      { headers: { "set-cookie": "better=session" } }
    )
  ),
  sessionApi: { getSession: vi.fn(async () => null) },
  devAuth: {
    enabled: true as const,
    token: "development-password",
    userId: "owner-dev",
  },
  secret: "s".repeat(32),
})

describe("Identity auth HTTP", () => {
  it("turns a valid development password into an HttpOnly session cookie", async () => {
    const auth = makeIdentityAuthHttpHandler(input())
    const login = await auth.handler(
      new Request("http://identity/api/dev/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "development-password" }),
      })
    )
    expect(login.status).toBe(200)
    expect(login.headers.get("set-cookie")).toContain("HttpOnly")
    const session = await auth.sessionApi.getSession({
      headers: new Headers({ cookie: login.headers.get("set-cookie")! }),
    })
    expect(session).toEqual({ user: { id: "owner-dev" } })
  })

  it("rejects a wrong password and delegates Better Auth routes unchanged", async () => {
    const dependencies = input()
    const auth = makeIdentityAuthHttpHandler(dependencies)
    const rejected = await auth.handler(
      new Request("http://identity/api/dev/login", {
        method: "POST",
        body: JSON.stringify({ password: "wrong" }),
      })
    )
    expect(rejected.status).toBe(401)
    const delegated = await auth.handler(
      new Request("http://identity/api/auth/sign-in/social", { method: "POST" })
    )
    expect(delegated.headers.get("set-cookie")).toBe("better=session")
    expect(dependencies.betterAuthHandler).toHaveBeenCalledOnce()
  })

  it("does not expose development authentication when disabled", async () => {
    const dependencies = input()
    const auth = makeIdentityAuthHttpHandler({
      ...dependencies,
      devAuth: { enabled: false },
    })
    expect(
      (
        await auth.handler(
          new Request("http://identity/api/dev/login", { method: "POST" })
        )
      ).status
    ).toBe(404)
  })

  it("cancels chunked login bodies when they exceed the bound", async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5_000))
        controller.enqueue(new Uint8Array(5_000))
      },
      cancel,
    })
    const auth = makeIdentityAuthHttpHandler(input())
    const response = await auth.handler(
      new Request("http://identity/api/dev/login", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit)
    )
    expect(response.status).toBe(413)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("cancels stalled chunked login bodies at the deadline", async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel,
    })
    const auth = makeIdentityAuthHttpHandler(input(), { bodyTimeoutMillis: 10 })
    const response = await auth.handler(
      new Request("http://identity/api/dev/login", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit)
    )
    expect(response.status).toBe(408)
    expect(cancel).toHaveBeenCalledOnce()
  })
})
