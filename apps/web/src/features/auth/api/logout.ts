import type { AuthenticatedAuthState } from "../model"
import { fetchAuthState } from "./auth-state"

export class LogoutError extends Error {
  readonly status: number

  constructor(status: number) {
    super("ログアウトできませんでした")
    this.name = "LogoutError"
    this.status = status
  }
}

async function logoutDevelopmentSession(fetch: typeof globalThis.fetch) {
  const response = await fetch("/api/dev/logout", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  })
  if (!response.ok) throw new LogoutError(response.status)
}

async function logoutBetterAuthSession() {
  // ログアウトを実際に要求した時だけBetter Authを読み込む。
  const { createAuthClient } = await import("better-auth/react")
  const result = await createAuthClient().signOut()
  if (result.error) {
    throw new Error(result.error.message || "ログアウトできませんでした")
  }
}

type LogoutDependencies = Readonly<{
  fetch: typeof globalThis.fetch
  signOutBetterAuth: () => Promise<void>
}>

/**
 * HttpOnly Cookieをclientから推測せず、公開された認証状態で終了経路を選ぶ。
 * devとBetter Authが併設されている場合、dev Cookieを消した後も認証済みなら
 * 背後に残るBetter Auth sessionも終了し、暗黙のowner切替を防ぐ。
 */
export async function logoutSession(
  auth: AuthenticatedAuthState,
  dependencies: LogoutDependencies = {
    fetch: globalThis.fetch,
    signOutBetterAuth: logoutBetterAuthSession,
  }
): Promise<void> {
  if (auth.loginMethods.development) {
    await logoutDevelopmentSession(dependencies.fetch)
    const state = await fetchAuthState(dependencies.fetch).catch((error) => {
      if (error instanceof LogoutError) throw error
      throw new LogoutError(
        typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof error.status === "number"
          ? error.status
          : 0
      )
    })
    if (!state.authenticated) return
  }

  await dependencies.signOutBetterAuth()
}
