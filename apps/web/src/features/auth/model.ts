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

/** open redirectを避け、same-originの絶対パスだけを許可する。 */
export function safeRedirect(value: unknown, fallback = "/") {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
    ? value
    : fallback
}

export { currentPath } from "@/shared/lib/location"
