import type { PropsWithChildren } from "react"

import { useAppliedTheme } from "../hooks/use-applied-theme"

export type ThemeProviderProps = PropsWithChildren<{
  readonly disableTransitionOnChange?: boolean
}>

/**
 * テーマの反映だけを担う。値の配布はatomが行うので、contextは持たない。
 *
 * 以前はここがcontextの提供元で、`App`が`useTheme()`を呼んでいたため、テーマを
 * 切り替えるたびにrouter以下すべてが描き直されていた。atomにしたことで、
 * 描き直されるのは実際にテーマを読むcomponentだけになる。
 */
export function ThemeProvider({
  children,
  disableTransitionOnChange,
}: ThemeProviderProps) {
  useAppliedTheme({ disableTransitionOnChange })

  return children
}
