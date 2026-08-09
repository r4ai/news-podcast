import { queryOptions } from "@tanstack/react-query"
import { createAuthClient } from "better-auth/react"

export type AuthState = {
  readonly authenticated: boolean
  readonly loginMethods: {
    readonly development: boolean
    readonly google: boolean
  }
}

export class AuthStateError extends Error {
  readonly status: number

  constructor(status: number) {
    super("認証状態を確認できませんでした")
    this.name = "AuthStateError"
    this.status = status
  }
}

export const authClient = createAuthClient()

export const authStateQueryOptions = queryOptions({
  queryKey: ["auth-state"],
  queryFn: async (): Promise<AuthState> => {
    const response = await fetch("/api/auth/state", {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
    if (!response.ok) {
      throw new AuthStateError(response.status)
    }
    return (await response.json()) as AuthState
  },
  staleTime: 15_000,
})

export function safeRedirect(value: unknown, fallback = "/") {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
    ? value
    : fallback
}

export function currentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export async function loginWithGoogle(callbackURL: string) {
  const result = await authClient.signIn.social({
    provider: "google",
    callbackURL,
  })
  if (result.error) {
    throw new Error(
      result.error.message || "Googleログインを開始できませんでした"
    )
  }
}
