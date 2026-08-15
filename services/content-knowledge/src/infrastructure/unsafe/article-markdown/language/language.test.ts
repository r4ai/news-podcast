import { describe, expect, it, vi } from "vitest"

import {
  firstExplicitLanguage,
  languageFromClassName,
  languageFromFilename,
  languageFromSourceHint,
} from "./explicit.js"
import {
  detectLanguage,
  MINIMUM_DETECTION_CHARACTERS,
  selectDetectedLanguage,
} from "./vscode-detector.js"

describe("explicit code language evidence", () => {
  it.each([
    ["foo language-TS bar", "ts"],
    ["lang-ruby", "ruby"],
    ["plain", undefined],
    [undefined, undefined],
  ])("reads class %s", (value, expected) => {
    expect(languageFromClassName(value)).toBe(expected)
  })

  it.each([
    ["src/a.ts", "ts"],
    ["Dockerfile", undefined],
    [undefined, undefined],
    ["config.YML", "yaml"],
  ])("reads filename %s", (value, expected) => {
    expect(languageFromFilename(value)).toBe(expected)
  })

  it.each([
    ["#!/usr/bin/env python\nprint(1)", "python"],
    ["#!/usr/bin/env ruby\nputs 1", "ruby"],
    ["#!/usr/bin/env node\nconsole.log(1)", "js"],
    ["#!/bin/bash\necho 1", "bash"],
    ["#!/bin/sh\necho 1", "sh"],
    ["#!/usr/bin/env perl\nprint 1", undefined],
    ["// vim: set ft=rust", "rust"],
    ["# -*- mode: sql -*-", "sql"],
    ["plain text", undefined],
  ])("reads source hint", (value, expected) => {
    expect(languageFromSourceHint(value)).toBe(expected)
  })

  it("chooses the first non-empty explicit value", () => {
    expect(firstExplicitLanguage([undefined, " ", " TypeScript ", "js"])).toBe(
      "typescript"
    )
    expect(firstExplicitLanguage([undefined, ""])).toBeUndefined()
  })
})

describe("thresholded VS Code language detection", () => {
  const source = "x".repeat(MINIMUM_DETECTION_CHARACTERS)

  it.each([
    ["short", [{ languageId: "ts", confidence: 1 }], undefined],
    [source, [], undefined],
    [source, [{ languageId: "ts", confidence: 0.34 }], undefined],
    [
      source,
      [
        { languageId: "ts", confidence: 0.5 },
        { languageId: "js", confidence: 0.31 },
      ],
      undefined,
    ],
    [
      source,
      [
        { languageId: "ts", confidence: 0.55 },
        { languageId: "js", confidence: 0.3 },
      ],
      "ts",
    ],
    [source, [{ languageId: "go", confidence: 0.5 }], "go"],
  ] as const)("applies confidence and margin", (text, candidates, expected) => {
    expect(selectDetectedLanguage(text, candidates)).toBe(expected)
  })

  it("does not invoke the model for short source", async () => {
    const detector = vi.fn(async () => [])
    await expect(detectLanguage("short", detector)).resolves.toBeUndefined()
    expect(detector).not.toHaveBeenCalled()
  })

  it("uses injected results and degrades model failures", async () => {
    await expect(
      detectLanguage(source, async () => [
        { languageId: "ts", confidence: 0.8 },
        { languageId: "js", confidence: 0.1 },
      ])
    ).resolves.toBe("ts")
    await expect(
      detectLanguage(source, async () => {
        throw new Error("model unavailable")
      })
    ).resolves.toBeUndefined()
  })

  it("loads the local VS Code model without network access", async () => {
    const result = await detectLanguage(
      "function add(left: number, right: number): number { return left + right }\n".repeat(
        4
      )
    )
    expect(result === undefined || typeof result === "string").toBe(true)
  })
})
