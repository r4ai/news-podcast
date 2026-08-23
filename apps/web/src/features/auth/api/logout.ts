import type { AuthenticatedAuthState } from "../model"

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
 * devとBetter Authが併設されている場合はBetter Authを先に終了する。
 * 逆順だとdev logout直後に背後の別ownerへ主体が切り替わり、続く失敗時に
 * 古いownerのclient stateで新しいownerのAPIを操作できてしまう。
 */
export async function logoutSession(
  auth: AuthenticatedAuthState,
  dependencies: LogoutDependencies = {
    fetch: globalThis.fetch,
    signOutBetterAuth: logoutBetterAuthSession,
  }
): Promise<void> {
  if (auth.loginMethods.google) await dependencies.signOutBetterAuth()
  if (auth.loginMethods.development) {
    await logoutDevelopmentSession(dependencies.fetch)
  }
}
