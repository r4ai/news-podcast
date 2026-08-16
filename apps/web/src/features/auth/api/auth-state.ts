import { queryOptions } from "@tanstack/react-query"

import { AuthStateError, type AuthState } from "../model"

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

/**
 * 認証状態の確認は素の`fetch`で足りるので、better-authのclientは
 * Googleログインを実際に押したときだけ読み込む。ログイン方式の選択肢を
 * 見せるだけなら要らない。
 */
export async function loginWithGoogle(callbackURL: string) {
  const { createAuthClient } = await import("better-auth/react")
  const result = await createAuthClient().signIn.social({
    provider: "google",
    callbackURL,
  })
  if (result.error) {
    throw new Error(
      result.error.message || "Googleログインを開始できませんでした"
    )
  }
}
