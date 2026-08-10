import { describe, expect, it } from "vitest"

import { isTheme, resolveTheme, toggledTheme } from "./model"

describe("theme model", () => {
  it("accepts only the three known theme values", () => {
    expect(isTheme("system")).toBe(true)
    expect(isTheme("sepia")).toBe(false)
    expect(isTheme(null)).toBe(false)
  })

  it("toggles away from the currently rendered appearance", () => {
    expect(toggledTheme("dark", "dark")).toBe("light")
    expect(toggledTheme("light", "dark")).toBe("dark")
    // system は「今見えている見た目」の反対へ倒す
    expect(toggledTheme("system", "dark")).toBe("light")
    expect(toggledTheme("system", "light")).toBe("dark")
  })

  it("resolves system to the operating system preference", () => {
    expect(resolveTheme("system", "dark")).toBe("dark")
    expect(resolveTheme("light", "dark")).toBe("light")
  })
})
