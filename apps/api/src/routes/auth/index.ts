// 開発ログイン/ログアウトとBetter Authへの委譲。/v1系ミドルウェア（認証・観測）の対象外。
import type { RouteRegistrar } from "../../http/context.js"
import { registerAuthProxy } from "./auth-proxy.js"
import { registerAuthState } from "./auth-state.js"
import { registerDevLogin } from "./dev-login.js"
import { registerDevLogout } from "./dev-logout.js"

export const authRegistrars: readonly RouteRegistrar[] = [
  registerDevLogin,
  registerDevLogout,
  registerAuthState,
  registerAuthProxy,
]
