import { useCallback, useEffect, useMemo, useState } from "react"

import {
  COLOR_SCHEME_QUERY,
  isTheme,
  resolveTheme,
  toggledTheme,
  type ResolvedTheme,
  type Theme,
} from "../model"
import type { ThemeContextValue } from "../theme-context"

export type ThemeControllerOptions = {
  readonly defaultTheme?: Theme
  readonly storageKey?: string
  readonly disableTransitionOnChange?: boolean
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? "dark" : "light"
}

function suspendTransitions() {
  const style = document.createElement("style")
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
    )
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => style.remove())
    })
  }
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']")
  )
}

function isToggleShortcut(event: KeyboardEvent) {
  if (event.repeat) return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  if (isEditableTarget(event.target)) return false
  return event.key.toLowerCase() === "d"
}

/** DOM反映・localStorage同期・ショートカットをまとめたテーマ制御ロジック。 */
export function useThemeController({
  defaultTheme = "system",
  storageKey = "theme",
  disableTransitionOnChange = true,
}: ThemeControllerOptions = {}): ThemeContextValue {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(storageKey)
    return isTheme(stored) ? stored : defaultTheme
  })

  const setTheme = useCallback(
    (next: Theme) => {
      localStorage.setItem(storageKey, next)
      setThemeState(next)
    },
    [storageKey]
  )

  const applyTheme = useCallback(
    (next: Theme) => {
      const root = document.documentElement
      const resolved = resolveTheme(next, systemTheme())
      const restore = disableTransitionOnChange ? suspendTransitions() : null

      root.classList.remove("light", "dark")
      root.classList.add(resolved)
      root.style.colorScheme = resolved

      restore?.()
    },
    [disableTransitionOnChange]
  )

  useEffect(() => {
    applyTheme(theme)
    if (theme !== "system") return undefined

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => applyTheme("system")
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme, applyTheme])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isToggleShortcut(event)) return
      setThemeState((current) => {
        const next = toggledTheme(current, systemTheme())
        localStorage.setItem(storageKey, next)
        return next
      })
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [storageKey])

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return
      if (event.key !== storageKey) return
      setThemeState(isTheme(event.newValue) ? event.newValue : defaultTheme)
    }
    window.addEventListener("storage", handleStorageChange)
    return () => window.removeEventListener("storage", handleStorageChange)
  }, [defaultTheme, storageKey])

  return useMemo(() => ({ theme, setTheme }), [theme, setTheme])
}
