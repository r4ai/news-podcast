import { describe, expect, it } from "vitest"

import {
  extractCodeDisplayMeta,
  extractHighlightSpec,
  extractTitle,
  parseLineRanges,
} from "./line-ranges"

describe("line range metadata", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["1, 3-5, 8-6, bad, 0, 0-2", [1, 3, 4, 5, 6, 7, 8]],
    [" , nope-2", []],
  ] as const)("parses %s", (value, expected) => {
    expect([...parseLineRanges(value)]).toEqual(expected)
  })

  it("extracts legacy title/highlight forms", () => {
    expect(extractHighlightSpec(undefined)).toBeUndefined()
    expect(extractHighlightSpec("title=x")).toBeUndefined()
    expect(extractHighlightSpec("{ 1, 3-5 }")).toBe("1, 3-5")
    expect(extractTitle(undefined)).toBeUndefined()
    expect(extractTitle("plain")).toBeUndefined()
    expect(extractTitle('filename="x.ts"')).toBe("x.ts")
    expect(extractTitle('title="y.ts"')).toBe("y.ts")
  })

  it("extracts all named display metadata and validates numbers", () => {
    expect(
      extractCodeDisplayMeta(
        'title="x.ts" highlight="1,3" diffAdd="2" diffRemove="4" showLineNumbers=true startLine=10'
      )
    ).toEqual({
      title: "x.ts",
      highlight: "1,3",
      diffAdd: "2",
      diffRemove: "4",
      showLineNumbers: true,
      startLine: 10,
    })
    expect(extractCodeDisplayMeta("showLineNumbers=false startLine=0")).toEqual(
      {
        title: undefined,
        highlight: undefined,
        diffAdd: undefined,
        diffRemove: undefined,
        showLineNumbers: false,
        startLine: undefined,
      }
    )
    expect(
      extractCodeDisplayMeta("showLineNumbers=other startLine=nope")
    ).toMatchObject({ showLineNumbers: false, startLine: undefined })
    expect(extractCodeDisplayMeta(undefined).showLineNumbers).toBeUndefined()
  })
})
