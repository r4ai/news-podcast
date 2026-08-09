import { describe, expect, it } from "vitest"

import type { ObjectStore } from "@news-podcast/application"
import { ArticleArchiver } from "./article-archiver.js"

class MemoryObjects implements ObjectStore {
  readonly values = new Map<string, { body: Uint8Array; contentType: string }>()

  put(input: { key: string; body: Uint8Array; contentType: string }) {
    this.values.set(input.key, {
      body: input.body,
      contentType: input.contentType,
    })
    return Promise.resolve({
      key: input.key,
      byteLength: input.body.byteLength,
      contentType: input.contentType,
    })
  }

  get(key: string) {
    const value = this.values.get(key)
    return Promise.resolve(
      value
        ? {
            ...value,
            byteLength: value.body.byteLength,
          }
        : null
    )
  }

  delete(key: string) {
    this.values.delete(key)
    return Promise.resolve()
  }
}

describe("ArticleArchiver", () => {
  it("stores raw, sanitized replay, Markdown, and local assets", async () => {
    const objects = new MemoryObjects()
    const html = `<!doctype html><html><head><title>保存記事</title>
      <link rel="modulepreload" href="/entry.js">
      <link rel="preload" href="/preloaded.woff2" as="font">
      <style>@font-face{src:url('/inline.woff2')}</style></head>
      <body><article><h1>保存記事</h1><p>これは十分に意味のある記事本文です。</p>
      <img src="/image.png" style="background-image:url('/background.png')"><link rel="stylesheet" href="/style.css">
      <script>alert('x')</script></article></body></html>`
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input)
      if (url.endsWith("style.css"))
        return new Response('@font-face{src:url("/font.woff2")}', {
          headers: { "Content-Type": "text/css" },
        })
      if (url.endsWith(".woff2"))
        return new Response(new Uint8Array([4, 5, 6]), {
          headers: { "Content-Type": "font/woff2" },
        })
      if (url.endsWith("background.png"))
        return new Response(new Uint8Array([7, 8, 9]), {
          headers: { "Content-Type": "image/png" },
        })
      return url.endsWith("image.png")
        ? new Response(new Uint8Array([1, 2, 3]), {
            headers: { "Content-Type": "image/png" },
          })
        : new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
    }) as typeof fetch

    const result = await new ArticleArchiver(objects, fetcher).archive(
      "https://93.184.216.34/article"
    )

    const replay = new TextDecoder().decode(
      objects.values.get(result.replayKey)?.body
    )
    const markdown = new TextDecoder().decode(
      objects.values.get(result.markdownKey)?.body
    )
    expect(replay).not.toContain("<script")
    expect(replay).not.toContain("modulepreload")
    expect(replay).not.toContain("preloaded.woff2")
    expect(replay).not.toContain("frame-ancestors")
    expect(replay).toContain("assets/")
    expect(replay).toContain("Content-Security-Policy")
    expect(replay).not.toContain("/inline.woff2")
    expect(replay).not.toContain("/background.png")
    expect(markdown).toContain("# 保存記事")
    expect(markdown).toContain("記事本文")
    expect(result.assets).toHaveLength(4)
    const stylesheet = [...objects.values.values()].find(
      (value) => value.contentType === "text/css"
    )
    expect(new TextDecoder().decode(stylesheet?.body)).toMatch(
      /url\("[a-f0-9]{64}"\)/
    )
  })
})
