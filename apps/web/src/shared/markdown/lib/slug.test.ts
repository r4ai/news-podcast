import { describe, expect, it } from "vitest"

import { slugify, uniqueSlug } from "./slug"

describe("slugify", () => {
  it.each([
    ["Getting Started", "getting-started"],
    ["  Trim me  ", "trim-me"],
    ["Mixed CASE Words", "mixed-case-words"],
    ["a/b:c?d#e", "a-b-c-d-e"],
    ["multiple   spaces", "multiple-spaces"],
    ["--leading and trailing--", "leading-and-trailing"],
    ["設計を中心とした開発", "設計を中心とした開発"],
    ["日本語 と English", "日本語-と-english"],
    ["!!!", "section"],
    ["", "section"],
  ])("turns %j into %j", (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })
})

describe("uniqueSlug", () => {
  it("keeps the first occurrence and numbers the rest", () => {
    const seen = new Map<string, number>()
    expect(uniqueSlug("Setup", seen)).toBe("setup")
    expect(uniqueSlug("Setup", seen)).toBe("setup-1")
    expect(uniqueSlug("Setup", seen)).toBe("setup-2")
    expect(uniqueSlug("Other", seen)).toBe("other")
  })

  it("treats headings that slugify the same as collisions", () => {
    const seen = new Map<string, number>()
    expect(uniqueSlug("A B", seen)).toBe("a-b")
    expect(uniqueSlug("a/b", seen)).toBe("a-b-1")
  })
})
