import { createContext } from "react"

import type { Theme } from "./model"

export type ThemeContextValue = {
  readonly theme: Theme
  readonly setTheme: (theme: Theme) => void
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined
)
