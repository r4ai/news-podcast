import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { ArticleStateSchema, defaultArticleState } from "./article-library.js"

describe("article library domain", () => {
  it("creates immutable safe defaults", () => {
    const state = defaultArticleState()
    expect(state).toEqual({
      read: false,
      saved: false,
      readLater: false,
      hidden: false,
      hiddenAt: null,
    })
    expect(Object.isFrozen(state)).toBe(true)
  })

  it("rejects inconsistent hidden timestamps", () => {
    expect(() =>
      Schema.decodeUnknownSync(ArticleStateSchema)({
        ...defaultArticleState(),
        hiddenAt: "2026-08-13T02:00:00.000Z",
      })
    ).toThrow()
  })
})
