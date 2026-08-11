import { describe, expect, it } from "vitest"

import { buildMermaidThemeVariables } from "./mermaid-theme"

describe("buildMermaidThemeVariables", () => {
  it("maps semantic tokens onto mermaid's base theme variables", () => {
    const tokens: Record<string, string> = {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.1 0 0)",
      border: "oklch(0.9 0 0)",
      muted: "oklch(0.95 0 0)",
      "muted-foreground": "oklch(0.5 0 0)",
      accent: "oklch(0.9 0.05 250)",
      "accent-foreground": "oklch(0.2 0.05 250)",
      destructive: "oklch(0.5 0.2 30)",
    }
    const variables = buildMermaidThemeVariables((name) => tokens[name] ?? "")

    expect(variables.background).toBe("#ffffff")
    expect(variables.primaryTextColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(variables.lineColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(variables.errorTextColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(variables.noteTextColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(
      Object.values(variables).some((value) => value.includes("oklch"))
    ).toBe(false)
  })

  it("preserves OKLCH alpha as a Mermaid-compatible rgba color", () => {
    const variables = buildMermaidThemeVariables((name) =>
      name === "border" ? "oklch(1 0 0 / 10%)" : "oklch(0 0 0)"
    )

    expect(variables.lineColor).toBe("rgba(255, 255, 255, 0.1)")
  })
})
