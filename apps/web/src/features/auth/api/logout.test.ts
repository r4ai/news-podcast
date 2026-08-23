import { describe, expect, it, vi } from "vitest"

import type { AuthState } from "../model"
import { LogoutError, logoutSession } from "./logout"

const developmentAuth = {
  authenticated: true,
  userId: "owner-development",
  loginMethods: { development: true, google: false },
} as const satisfies AuthState

const googleAuth = {
  authenticated: true,
  userId: "owner-google",
  loginMethods: { development: false, google: true },
} as const satisfies AuthState

describe("logoutSession", () => {
  it("ends a development session without loading Better Auth", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const signOutBetterAuth = vi.fn()

    await logoutSession(developmentAuth, { fetch, signOutBetterAuth })

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/dev/logout",
      expect.objectContaining({ method: "POST", credentials: "include" })
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(signOutBetterAuth).not.toHaveBeenCalled()
  })

  it("ends a Better Auth session directly when development auth is disabled", async () => {
    const fetch = vi.fn()
    const signOutBetterAuth = vi.fn().mockResolvedValue(undefined)

    await logoutSession(googleAuth, { fetch, signOutBetterAuth })

    expect(fetch).not.toHaveBeenCalled()
    expect(signOutBetterAuth).toHaveBeenCalledOnce()
  })

  it("ends Better Auth before dev auth when both methods are enabled", async () => {
    const order: string[] = []
    const fetch = vi.fn(async () => {
      order.push("development")
      return new Response(null, { status: 204 })
    })
    const signOutBetterAuth = vi.fn().mockResolvedValue(undefined)
    signOutBetterAuth.mockImplementation(async () => {
      order.push("better-auth")
    })

    await logoutSession(
      {
        ...googleAuth,
        loginMethods: { development: true, google: true },
      },
      { fetch, signOutBetterAuth }
    )

    expect(order).toEqual(["better-auth", "development"])
  })

  it("keeps a failed development logout retryable", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    const signOutBetterAuth = vi.fn()

    await expect(
      logoutSession(developmentAuth, { fetch, signOutBetterAuth })
    ).rejects.toBeInstanceOf(LogoutError)
    expect(signOutBetterAuth).not.toHaveBeenCalled()
  })

  it("does not switch away from the dev owner when Better Auth logout fails", async () => {
    const failure = new Error("provider unavailable")
    const fetch = vi.fn()

    await expect(
      logoutSession(
        {
          ...developmentAuth,
          loginMethods: { development: true, google: true },
        },
        {
          fetch,
          signOutBetterAuth: vi.fn().mockRejectedValue(failure),
        }
      )
    ).rejects.toBe(failure)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("surfaces a Better Auth sign-out failure", async () => {
    const failure = new Error("provider unavailable")

    await expect(
      logoutSession(googleAuth, {
        fetch: vi.fn(),
        signOutBetterAuth: vi.fn().mockRejectedValue(failure),
      })
    ).rejects.toBe(failure)
  })
})
