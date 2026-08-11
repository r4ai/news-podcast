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

    expect(variables.background).toBe(tokens.background)
    expect(variables.primaryTextColor).toBe(tokens.foreground)
    expect(variables.lineColor).toBe(tokens.border)
    expect(variables.errorTextColor).toBe(tokens.destructive)
    expect(variables.noteTextColor).toBe(tokens["muted-foreground"])
  })
})
