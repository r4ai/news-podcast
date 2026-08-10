import { queryOptions } from "@tanstack/react-query"
import { createAuthClient } from "better-auth/react"

import { AuthStateError, type AuthState } from "../model"

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
