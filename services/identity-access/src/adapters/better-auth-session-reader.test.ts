import { Effect, Option } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { SessionLookupRequest } from "../application/ports/session-reader.js"
import { makeBetterAuthSessionReader } from "./better-auth-session-reader.js"

const request: SessionLookupRequest = {
  headers: [{ name: "cookie", value: "better-auth.session_token=secret" }],
}

describe("Better Auth session reader", () => {
  it("parses a Better Auth session and discards provider-only fields", async () => {
    const providerSession = {
      session: { id: "session-1", expiresAt: new Date("2026-08-13") },
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
      },
    }
    const getSession = vi.fn().mockResolvedValue(providerSession)
    const reader = makeBetterAuthSessionReader({ getSession })

    const result = await Effect.runPromise(
      reader.findAuthenticatedActor(request)
    )

    expect(Option.getOrThrow(result)).toEqual({
      _tag: "Authenticated",
      userId: "user-1",
    })
    expect(Object.isFrozen(Option.getOrThrow(result))).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(reader)).toBe(true)
    expect(Object.isFrozen(providerSession)).toBe(false)
    expect(Object.isFrozen(providerSession.user)).toBe(false)
    expect(getSession).toHaveBeenCalledOnce()
    const input = getSession.mock.calls[0]?.[0]
    expect(input.headers).toBeInstanceOf(Headers)
    expect(input.headers.get("cookie")).toBe("better-auth.session_token=secret")
  })

  it("maps a null Better Auth session to absence", async () => {
    const reader = makeBetterAuthSessionReader({
      getSession: () => Promise.resolve(null),
    })

    const result = await Effect.runPromise(
      reader.findAuthenticatedActor(request)
    )

    expect(Option.isNone(result)).toBe(true)
  })

  it("rejects malformed provider success data as a typed error", async () => {
    const reader = makeBetterAuthSessionReader({
      getSession: () => Promise.resolve({ user: { id: "" } }),
    })

    const exit = await Effect.runPromiseExit(
      reader.findAuthenticatedActor(request)
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("MalformedSessionResponse")
    }
  })

  it("maps Better Auth outages to a typed availability error", async () => {
    const reader = makeBetterAuthSessionReader({
      getSession: () => Promise.reject(new Error("database unavailable")),
    })

    const exit = await Effect.runPromiseExit(
      reader.findAuthenticatedActor(request)
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("SessionProviderUnavailable")
    }
  })
})
