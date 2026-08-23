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

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("logoutSession", () => {
  it("ends a development session without loading Better Auth", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        response({
          authenticated: false,
          loginMethods: { development: true, google: false },
        })
      )
    const signOutBetterAuth = vi.fn()

    await logoutSession(developmentAuth, { fetch, signOutBetterAuth })

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/dev/logout",
      expect.objectContaining({ method: "POST", credentials: "include" })
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/auth/state",
      expect.objectContaining({ credentials: "include" })
    )
    expect(signOutBetterAuth).not.toHaveBeenCalled()
  })

  it("ends a Better Auth session directly when development auth is disabled", async () => {
    const fetch = vi.fn()
    const signOutBetterAuth = vi.fn().mockResolvedValue(undefined)

    await logoutSession(googleAuth, { fetch, signOutBetterAuth })

    expect(fetch).not.toHaveBeenCalled()
    expect(signOutBetterAuth).toHaveBeenCalledOnce()
  })

  it("also ends Better Auth when a no-op dev logout leaves a session active", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        response({
          authenticated: true,
          userId: "owner-google",
          loginMethods: { development: true, google: true },
        })
      )
    const signOutBetterAuth = vi.fn().mockResolvedValue(undefined)

    await logoutSession(
      {
        ...googleAuth,
        loginMethods: { development: true, google: true },
      },
      { fetch, signOutBetterAuth }
    )

    expect(signOutBetterAuth).toHaveBeenCalledOnce()
  })

  it.each([
    ["development logout", 503, 0],
    ["auth-state probe", 204, 503],
  ])(
    "keeps a failed %s retryable",
    async (_scenario, logoutStatus, stateStatus) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: logoutStatus }))
      if (stateStatus !== 0) {
        fetch.mockResolvedValueOnce(
          response({ error: "unavailable" }, stateStatus)
        )
      }
      const signOutBetterAuth = vi.fn()

      await expect(
        logoutSession(developmentAuth, { fetch, signOutBetterAuth })
      ).rejects.toBeInstanceOf(LogoutError)
      expect(signOutBetterAuth).not.toHaveBeenCalled()
    }
  )

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
