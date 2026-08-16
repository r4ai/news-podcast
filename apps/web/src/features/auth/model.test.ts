import { describe, expect, it } from "vitest"

import { safeRedirect } from "./model"

describe("safeRedirect", () => {
  it("keeps same-origin absolute paths", () => {
    expect(safeRedirect("/library")).toBe("/library")
    expect(safeRedirect("/subscriptions?tab=all")).toBe(
      "/subscriptions?tab=all"
    )
  })

  it("rejects protocol-relative and external destinations", () => {
    expect(safeRedirect("//evil.example.com")).toBe("/")
    expect(safeRedirect("/\\evil.example.com")).toBe("/")
    expect(safeRedirect("/\\\\evil.example.com")).toBe("/")
    expect(safeRedirect("/library\\evil.example.com")).toBe("/")
    expect(safeRedirect("https://evil.example.com")).toBe("/")
    expect(safeRedirect(undefined, "/login")).toBe("/login")
  })
})
