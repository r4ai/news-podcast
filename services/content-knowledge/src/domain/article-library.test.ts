import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  ArticleCursorSchema,
  ArticleStateSchema,
  articleSortKey,
  decodeArticleCursor,
  defaultArticleState,
  encodeArticleCursor,
} from "./article-library.js"

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

const articleId = "5af55f2e-ff0b-475c-866a-f2cff48c101d"

describe("article ordering key", () => {
  it("prefers the publication instant and falls back to discovery", () => {
    expect(
      articleSortKey({
        publishedAt: "2026-08-13T00:00:00.000Z",
        discoveredAt: "2026-08-13T01:01:00.000Z",
      })
    ).toBe("2026-08-13T00:00:00.000Z")
    expect(
      articleSortKey({
        publishedAt: null,
        discoveredAt: "2026-08-13T01:01:00.000Z",
      })
    ).toBe("2026-08-13T01:01:00.000Z")
  })
})

describe("article cursor", () => {
  const position = {
    sortKey: "2026-08-13T00:00:00.000Z" as never,
    articleId: articleId as never,
  }

  it("round-trips a keyset position through an opaque token", () => {
    const cursor = encodeArticleCursor(position)
    expect(cursor).not.toContain(articleId)
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Schema.decodeUnknownSync(ArticleCursorSchema)(cursor)).toBe(cursor)
    expect(decodeArticleCursor(cursor)).toEqual(position)
  })

  it.each([
    ["empty", ""],
    ["not base64url", "!!not-a-cursor!!"],
    ["base64url of non JSON", base64url("nonsense")],
    [
      "missing article",
      base64url(JSON.stringify({ sortKey: position.sortKey })),
    ],
    [
      "non UTC sort key",
      base64url(JSON.stringify({ sortKey: "2026-08-13", articleId })),
    ],
    [
      "non UUID article",
      base64url(JSON.stringify({ sortKey: position.sortKey, articleId: "x" })),
    ],
  ])("rejects a %s token", (_name, cursor) => {
    expect(decodeArticleCursor(cursor)).toBeUndefined()
    expect(() =>
      Schema.decodeUnknownSync(ArticleCursorSchema)(cursor)
    ).toThrow()
  })
})

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}
