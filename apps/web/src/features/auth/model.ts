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

const containsRedirectControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return character === "\\" || codePoint <= 0x1f || codePoint === 0x7f
  })

/** open redirectを避け、same-originの絶対パスだけを許可する。 */
export function safeRedirect(value: unknown, fallback = "/") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    containsRedirectControlCharacter(value)
  )
    return fallback

  const trustedOrigin = "https://same-origin.invalid"
  try {
    const destination = new URL(value, trustedOrigin)
    return destination.origin === trustedOrigin
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : fallback
  } catch {
    return fallback
  }
}

export { currentPath } from "@/shared/lib/location"
