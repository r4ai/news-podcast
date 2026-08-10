import type { PropsWithChildren } from "react"

import {
  useThemeController,
  type ThemeControllerOptions,
} from "../hooks/use-theme-controller"
import { ThemeContext } from "../theme-context"

export type ThemeProviderProps = PropsWithChildren<ThemeControllerOptions>

export function ThemeProvider({ children, ...options }: ThemeProviderProps) {
  const value = useThemeController(options)

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
