import { describe, expect, it } from "vitest"

import { allowlistedEmbed, safeFallbackUrl } from "./embed"

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
    expect(allowlistedEmbed(url)?.url.href).toBe(url)
  })

  it.each([
    "http://www.youtube.com/embed/abc",
    "https://www.youtube.com/watch?v=abc",
    "https://tracker.example/embed/abc",
    "not a url",
  ])("rejects %s", (url) => {
    expect(allowlistedEmbed(url)).toBeUndefined()
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

describe("embed sandbox policy", () => {
  const allowed = [
    "https://www.youtube.com/embed/abc",
    "https://www.youtube-nocookie.com/embed/abc",
    "https://player.vimeo.com/video/123",
    "https://speakerdeck.com/player/abc",
    "https://www.docswell.com/slide/abc",
    "https://codepen.io/user/embed/abc",
    "https://codesandbox.io/embed/abc",
    "https://stackblitz.com/edit/abc",
    "https://www.figma.com/embed?url=x",
  ]

  it.each(allowed)("never lets %s escape its sandbox", (url) => {
    const sandbox = allowlistedEmbed(url)?.sandbox ?? ""
    // `allow-same-origin`と`allow-scripts`が揃うと、iframeの中から自分の
    // sandbox属性を書き換えて制限を全て外せる。片方だけなら破れない。
    expect(sandbox).not.toContain("allow-same-origin")
    // 親フレームの乗っ取りとダウンロード実行も許さない。
    expect(sandbox).not.toContain("allow-top-navigation")
    expect(sandbox).not.toContain("allow-downloads")
  })

  it.each(allowed)("lets %s run the scripts its player needs", (url) => {
    // 動画・スライド・コードエディタはJavaScriptなしでは何も描画できない。
    // 全面禁止のままだとprovider側のエラー画面が出るだけになる。
    expect(allowlistedEmbed(url)?.sandbox).toContain("allow-scripts")
  })
})
