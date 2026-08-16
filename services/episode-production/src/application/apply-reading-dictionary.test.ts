import { describe, expect, it } from "vitest"

import { applyReadingDictionary } from "./apply-reading-dictionary.js"

const entry = (surface: string, reading: string) => ({
  surface: surface as never,
  reading: reading as never,
  accentType: 0 as never,
})

describe("reading dictionary text application", () => {
  it("applies the longest surface once without cascading replacements", () => {
    expect(
      applyReadingDictionary("OpenAIとAI。エーアイ。", [
        entry("AI", "エーアイ"),
        entry("OpenAI", "オープンエーアイ"),
        entry("エーアイ", "エイアイ"),
      ])
    ).toEqual({
      text: "オープンエーアイとエーアイ。エイアイ。",
      replacementCount: 3,
    })
  })

  it("leaves unmatched text unchanged", () => {
    expect(
      applyReadingDictionary("辞書にない文章", [
        entry("OpenAI", "オープンエーアイ"),
      ])
    ).toEqual({ text: "辞書にない文章", replacementCount: 0 })
  })
})
