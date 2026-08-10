import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { useThemeController } from "./use-theme-controller"

describe("useThemeController", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ""
  })

  it("restores a persisted theme and reflects it on the document element", () => {
    localStorage.setItem("theme", "dark")

    const { result } = renderHook(() => useThemeController())

    expect(result.current.theme).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("falls back to the default when storage holds an unknown value", () => {
    localStorage.setItem("theme", "sepia")

    const { result } = renderHook(() =>
      useThemeController({ defaultTheme: "light" })
    )

    expect(result.current.theme).toBe("light")
  })

  it("persists the theme so other tabs observe the change", () => {
    const { result } = renderHook(() => useThemeController())

    act(() => result.current.setTheme("dark"))

    expect(localStorage.getItem("theme")).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("toggles with the d shortcut but ignores editable targets", () => {
    const { result } = renderHook(() => useThemeController())
    const input = document.createElement("input")
    document.body.appendChild(input)

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "d", bubbles: true })
      )
    })
    expect(result.current.theme).toBe("system")

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }))
    })
    expect(result.current.theme).toBe("dark")

    input.remove()
  })
})
