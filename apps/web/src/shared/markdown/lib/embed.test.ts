import { describe, expect, it } from "vitest"

import { allowlistedEmbedUrl, safeFallbackUrl } from "./embed"

describe("embed URL policy", () => {
  it.each([
    "https://www.youtube.com/embed/abc",
    "https://www.youtube-nocookie.com/embed/abc",
    "https://player.vimeo.com/video/123",
    "https://speakerdeck.com/player/abc",
    "https://www.docswell.com/slide/abc",
    "https://codepen.io/user/embed/abc",
    "https://codesandbox.io/embed/abc",
    "https://stackblitz.com/edit/abc",
    "https://www.figma.com/embed?url=x",
  ])("allows %s", (url) => {
    expect(allowlistedEmbedUrl(url)?.href).toBe(url)
  })

  it.each([
    "http://www.youtube.com/embed/abc",
    "https://www.youtube.com/watch?v=abc",
    "https://tracker.example/embed/abc",
    "not a url",
  ])("rejects %s", (url) => {
    expect(allowlistedEmbedUrl(url)).toBeUndefined()
  })

  it.each([
    ["https://example.com/x", "https://example.com/x"],
    ["http://example.com/x", "http://example.com/x"],
    ["javascript:x", undefined],
    ["not a url", undefined],
  ])("normalizes fallback %s", (url, expected) => {
    expect(safeFallbackUrl(url)).toBe(expected)
  })
})
