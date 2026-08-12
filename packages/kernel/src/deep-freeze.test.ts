import { describe, expect, it } from "vitest"

import { deepFreeze } from "./deep-freeze.js"

describe("deepFreeze", () => {
  it("freezes every nested record and array without changing the value", () => {
    const input = {
      episode: {
        title: "Morning news",
        segments: [{ title: "Opening" }],
      },
    }

    const frozen = deepFreeze(input)

    expect(frozen).toBe(input)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.episode)).toBe(true)
    expect(Object.isFrozen(frozen.episode.segments)).toBe(true)
    expect(Object.isFrozen(frozen.episode.segments[0])).toBe(true)
    expect(() =>
      (frozen.episode.segments as { title: string }[]).push({
        title: "Closing",
      })
    ).toThrow()
  })

  it("terminates for cyclic input", () => {
    const input: { readonly name: string; self?: unknown } = { name: "cycle" }
    ;(input as { self?: unknown }).self = input

    const frozen = deepFreeze(input)

    expect(frozen.self).toBe(frozen)
    expect(Object.isFrozen(frozen)).toBe(true)
  })
})
