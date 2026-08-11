import { describe, expect, it } from "vitest"

import {
  decorateLine,
  languageFromClassName,
  lineDecorationClassName,
  splitCodeLines,
} from "./code-lines"

describe("languageFromClassName", () => {
  it("extracts the language token", () => {
    expect(languageFromClassName("language-sql foo")).toBe("sql")
  })

  it("returns undefined when there is no language class", () => {
    expect(languageFromClassName("foo bar")).toBeUndefined()
    expect(languageFromClassName(undefined)).toBeUndefined()
  })
})

describe("splitCodeLines", () => {
  it("drops a single trailing newline, matching Shiki's stripEndNewline", () => {
    expect(splitCodeLines("a\nb\n")).toEqual(["a", "b"])
  })

  it("keeps embedded blank lines", () => {
    expect(splitCodeLines("a\n\nb")).toEqual(["a", "", "b"])
  })

  it("returns an empty array for empty input", () => {
    expect(splitCodeLines("")).toEqual([])
  })
})

describe("decorateLine", () => {
  const base = {
    lang: undefined,
    highlighted: new Set<number>([2]),
    added: new Set<number>([3]),
    removed: new Set<number>(),
  }

  it("marks a line highlighted via the fence meta range", () => {
    expect(decorateLine(2, "x", base).highlighted).toBe(true)
    expect(decorateLine(1, "x", base).highlighted).toBe(false)
  })

  it("marks a line added via notation comments", () => {
    expect(decorateLine(3, "x", base).diff).toBe("add")
  })

  it("reads diff markers from the raw line when lang is diff", () => {
    const diffContext = { ...base, lang: "diff" }
    expect(decorateLine(1, "+added", diffContext).diff).toBe("add")
    expect(decorateLine(1, "-removed", diffContext).diff).toBe("remove")
    expect(decorateLine(1, " unchanged", diffContext).diff).toBeUndefined()
  })
})

describe("lineDecorationClassName", () => {
  it("prioritizes diff over plain highlight", () => {
    expect(
      lineDecorationClassName({ highlighted: true, diff: "add" })
    ).toContain("accent")
  })

  it("falls back to the highlight style when there is no diff", () => {
    expect(
      lineDecorationClassName({ highlighted: true, diff: undefined })
    ).toContain("muted")
  })

  it("returns undefined for a plain, undecorated line", () => {
    expect(
      lineDecorationClassName({ highlighted: false, diff: undefined })
    ).toBeUndefined()
  })
})
