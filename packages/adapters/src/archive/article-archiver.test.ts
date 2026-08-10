import { describe, expect, it } from "vitest"
import { parseHTML } from "linkedom"

import type { ObjectStore } from "@news-podcast/application"
import { DEFAULT_ARCHIVE_LIMITS } from "../config.js"
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
    const requestedUrls: string[] = []
    const html = `<!doctype html><html><head><title>保存記事</title>
      <link rel="modulepreload" href="/entry.js">
      <link rel="preload" href="/preloaded.woff2" as="font">
      <link rel="apple-touch-icon" href="/touch.png">
      <meta name="msapplication-TileImage" content="/tile.png">
      <style>@font-face{src:url('/inline.woff2')}</style></head>
      <body><article><h1>保存記事</h1><p>これは十分に意味のある記事本文です。</p>
      <img src="/image.png" style="background-image:url('/background.png')"><link rel="stylesheet" href="/style.css">
      <script>alert('x')</script></article></body></html>`
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.endsWith("style.css"))
        return new Response(
          '@IMPORT "/theme.css";.example{content:"url(/not-an-asset.png)"}@font-face{src:url("/font.woff2")}',
          {
            headers: { "Content-Type": "text/css" },
          }
        )
      if (url.endsWith("theme.css"))
        return new Response("p{color:navy}", {
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
    expect(replay).not.toContain("touch.png")
    expect(replay).not.toContain("tile.png")
    expect(replay).not.toContain("frame-ancestors")
    expect(replay).toContain("assets/")
    expect(replay).toContain("Content-Security-Policy")
    expect(replay).not.toContain("/inline.woff2")
    expect(replay).not.toContain("/background.png")
    expect(markdown).toContain("# 保存記事")
    expect(markdown).toContain("記事本文")
    expect(result.assets).toHaveLength(5)
    expect(requestedUrls.some((url) => url.endsWith("not-an-asset.png"))).toBe(
      false
    )
    const stylesheet = [...objects.values.values()].find(
      (value) =>
        value.contentType === "text/css" &&
        new TextDecoder().decode(value.body).includes("@font-face")
    )
    const stylesheetText = new TextDecoder().decode(stylesheet?.body)
    expect(stylesheetText).toMatch(/url\("[a-f0-9]{64}"\)/)
    expect(stylesheetText).toMatch(/@import "[a-f0-9]{64}"/i)
    expect(stylesheetText).toContain('content:"url(/not-an-asset.png)"')
  })

  it("captures linked stylesheets before images when the asset budget is full", async () => {
    const objects = new MemoryObjects()
    const images = Array.from(
      { length: 90 },
      (_, index) => `<img src="/image-${index}.png">`
    ).join("")
    const html = `<!doctype html><html><head><title>Priority</title>
      <link rel="stylesheet" href="/critical.css"></head><body>${images}</body></html>`
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input)
      if (url.endsWith("critical.css"))
        return new Response("body{display:block}", {
          headers: { "Content-Type": "text/css" },
        })
      if (url.includes("image-"))
        return new Response(
          new Uint8Array([Number(url.match(/image-(\d+)/)?.[1] ?? 0)]),
          {
            headers: { "Content-Type": "image/png" },
          }
        )
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }) as typeof fetch

    const result = await new ArticleArchiver(objects, fetcher, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxAssets: 80,
    }).archive("https://93.184.216.34/article")
    const replay = new TextDecoder().decode(
      objects.values.get(result.replayKey)?.body
    )

    const stylesheet = parseHTML(replay).document.querySelector("link")
    expect(stylesheet?.getAttribute("rel")).toBe("stylesheet")
    expect(stylesheet?.getAttribute("href")).toMatch(/^assets\/[a-f0-9]{64}$/)
    expect(result.assets).toHaveLength(80)
  })

  it("captures every srcset candidate including CDN URLs with commas", async () => {
    const objects = new MemoryObjects()
    const html = `<!doctype html><html><head><title>Responsive</title></head><body>
      <picture><source srcset="/small.webp 480w, /large.webp 960w">
      <img src="/fallback.png" srcset="/plain.png, /cdn,w_1200,c_limit.png 2x"></picture>
      </body></html>`
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input)
      if (url.endsWith("/article"))
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      return new Response(new TextEncoder().encode(url), {
        headers: { "Content-Type": "image/webp" },
      })
    }) as typeof fetch

    const result = await new ArticleArchiver(objects, fetcher).archive(
      "https://93.184.216.34/article"
    )
    const replay = new TextDecoder().decode(
      objects.values.get(result.replayKey)?.body
    )
    const document = parseHTML(replay).document

    expect(document.querySelector("source")?.getAttribute("srcset")).toMatch(
      /^assets\/[a-f0-9]{64} 480w, assets\/[a-f0-9]{64} 960w$/
    )
    expect(document.querySelector("img")?.getAttribute("srcset")).toMatch(
      /^assets\/[a-f0-9]{64}, assets\/[a-f0-9]{64} 2x$/
    )
    expect(replay).not.toContain("cdn,w_1200,c_limit.png")
    expect(result.assets).toHaveLength(5)
  })

  it("does not charge duplicate content against the asset count limit", async () => {
    const objects = new MemoryObjects()
    const html = `<!doctype html><html><head><title>Duplicates</title></head><body>
      <img src="/one.png"><img src="/two.png"></body></html>`
    const fetcher = (async (input: URL | RequestInfo) =>
      String(input).endsWith("/article")
        ? new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
        : new Response(new Uint8Array([1, 2, 3]), {
            headers: { "Content-Type": "image/png" },
          })) as typeof fetch

    const result = await new ArticleArchiver(objects, fetcher, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxAssets: 1,
    }).archive("https://93.184.216.34/article")
    const replay = new TextDecoder().decode(
      objects.values.get(result.replayKey)?.body
    )

    expect(replay.match(/src="assets\/[a-f0-9]{64}"/g)).toHaveLength(2)
    expect(result.assets).toHaveLength(1)
  })

  it("uses a safe reader layout when a site stylesheet cannot be captured", async () => {
    const objects = new MemoryObjects()
    const html = `<!doctype html><html><head><title>Fallback</title>
      <link rel="stylesheet" href="/blocked.css"></head><body>
      <header><svg width="2000"></svg></header><main><article>
      <h1>Readable article</h1><p>This article body remains available.</p><img src="/photo.png">
      </article></main></body></html>`
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input)
      return url.endsWith("blocked.css")
        ? new Response("<html>challenge</html>", {
            headers: { "Content-Type": "text/html" },
          })
        : url.endsWith("photo.png")
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

    expect(replay).toContain('data-archive-view="reader"')
    expect(replay).toContain("This article body remains available.")
    expect(replay).toContain("元の記事を開く")
    expect(replay).toMatch(/<img src="assets\/[a-f0-9]{64}">/)
    expect(replay).not.toContain('width="2000"')
    expect(replay).not.toContain("blocked.css")
  })

  it("handles passive fetch attributes without leaving external subresources", async () => {
    const objects = new MemoryObjects()
    const html = `<!doctype html><html><head><title>Assets</title>
      <link REL=MANIFEST href=/app.webmanifest></head><body background="/legacy.png">
      <input TYPE=IMAGE src="/button.png"><video src="/movie.mp4" poster="/poster.png"></video>
      <audio src="/audio.mp3"></audio><track src="/captions.vtt">
      <svg><image href="/diagram.svg"></image><use xlink:href="/sprite.svg#icon"></use></svg>
      </body></html>`
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input)
      if (url.endsWith("/article"))
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      return new Response(new TextEncoder().encode(url), {
        headers: { "Content-Type": "application/octet-stream" },
      })
    }) as typeof fetch

    const result = await new ArticleArchiver(objects, fetcher).archive(
      "https://93.184.216.34/article"
    )
    const replay = new TextDecoder().decode(
      objects.values.get(result.replayKey)?.body
    )

    expect(replay).not.toMatch(
      /app\.webmanifest|legacy\.png|sprite\.svg|\/button\.png|\/movie\.mp4|\/poster\.png|\/audio\.mp3|\/captions\.vtt|\/diagram\.svg/
    )
    expect(replay.match(/assets\/[a-f0-9]{64}/g)).toHaveLength(6)
  })
})
