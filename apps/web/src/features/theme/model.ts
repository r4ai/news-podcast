export type Theme = "dark" | "light" | "system"
export type ResolvedTheme = "dark" | "light"

const THEME_VALUES: readonly Theme[] = ["dark", "light", "system"]

export const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"

export function isTheme(value: string | null): value is Theme {
  return value !== null && THEME_VALUES.includes(value as Theme)
}

/** `d`キーで切り替えたときの次のテーマ。純関数なので単体テストできる。 */
export function toggledTheme(
  current: Theme,
  systemTheme: ResolvedTheme
): ResolvedTheme {
  if (current === "system") {
    return systemTheme === "dark" ? "light" : "dark"
  }
  return current === "dark" ? "light" : "dark"
}

export function resolveTheme(
  theme: Theme,
  systemTheme: ResolvedTheme
): ResolvedTheme {
  return theme === "system" ? systemTheme : theme
}
