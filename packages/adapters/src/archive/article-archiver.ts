import { createHash, randomUUID } from "node:crypto"

import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import TurndownService from "turndown"

import type { ObjectStore } from "@news-podcast/application"
import { createSafeFetcher } from "../http/safe-fetch.js"

const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_ASSET_BYTES = 10 * 1024 * 1024
const MAX_ASSETS = 40

export interface ArchivedArticle {
  readonly snapshotId: string
  readonly title: string
  readonly sourceUrl: string
  readonly contentHash: string
  readonly rawKey: string
  readonly replayKey: string
  readonly markdownKey: string
  readonly byteLength: number
  readonly assets: readonly {
    readonly hash: string
    readonly originalUrl: string
    readonly key: string
    readonly contentType: string
    readonly byteLength: number
  }[]
}

export class ArticleArchiver {
  private readonly fetcher: typeof fetch

  constructor(
    private readonly objects: ObjectStore,
    fetcher: typeof fetch = fetch
  ) {
    this.fetcher = createSafeFetcher(fetcher)
  }

  async archive(urlValue: string): Promise<ArchivedArticle> {
    const response = await this.fetcher(urlValue, {
      headers: { "User-Agent": "NewsPodcastArchive/0.1 (+self-hosted)" },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok)
      throw new Error(`Article request failed: ${response.status}`)
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().includes("text/html")) {
      throw new Error("Article response is not HTML")
    }
    const raw = new Uint8Array(await response.arrayBuffer())
    if (raw.byteLength > MAX_HTML_BYTES)
      throw new Error("Article HTML is too large")
    const sourceUrl = response.url || urlValue
    const html = new TextDecoder().decode(raw)
    const contentHash = hash(raw)
    const snapshotId = randomUUID()
    const prefix = `articles/${snapshotId}`

    const { document } = parseHTML(html)
    ensureBase(document, sourceUrl)
    normalizeNavigation(document, sourceUrl)
    sanitize(document)
    const assets = await this.captureAssets(document, sourceUrl, prefix)
    document
      .querySelectorAll("base")
      .forEach((element: Element) => element.remove())
    const replay = addContentSecurityPolicy(document.toString())
    const markdown = extractMarkdown(html, sourceUrl)
    const title =
      document.querySelector("title")?.textContent?.trim() ||
      new URL(sourceUrl).hostname

    const rawKey = `${prefix}/raw/response.html`
    const metadataKey = `${prefix}/raw/response.json`
    const replayKey = `${prefix}/replay/index.html`
    const markdownKey = `${prefix}/markdown/article.md`
    const encoder = new TextEncoder()
    await Promise.all([
      this.objects.put({
        key: rawKey,
        body: raw,
        contentType: "text/html; charset=utf-8",
      }),
      this.objects.put({
        key: metadataKey,
        body: encoder.encode(
          JSON.stringify({
            sourceUrl,
            fetchedAt: new Date().toISOString(),
            status: response.status,
            headers: safeHeaders(response.headers),
          })
        ),
        contentType: "application/json",
      }),
      this.objects.put({
        key: replayKey,
        body: encoder.encode(replay),
        contentType: "text/html; charset=utf-8",
      }),
      this.objects.put({
        key: markdownKey,
        body: encoder.encode(markdown),
        contentType: "text/markdown; charset=utf-8",
      }),
    ])

    return {
      snapshotId,
      title,
      sourceUrl,
      contentHash,
      rawKey,
      replayKey,
      markdownKey,
      byteLength: raw.byteLength,
      assets,
    }
  }

  private async captureAssets(
    document: ReturnType<typeof parseHTML>["document"],
    sourceUrl: string,
    prefix: string
  ) {
    const candidates: { element: Element; attribute: "src" | "href" }[] = []
    document
      .querySelectorAll("img[src],source[src]")
      .forEach((element: Element) =>
        candidates.push({ element, attribute: "src" })
      )
    document
      .querySelectorAll('link[rel~="stylesheet"][href],link[rel~="icon"][href]')
      .forEach((element: Element) =>
        candidates.push({ element, attribute: "href" })
      )

    const stored: {
      hash: string
      originalUrl: string
      key: string
      contentType: string
      byteLength: number
    }[] = []
    const capturedByUrl = new Map<string, string>()
    const capture = async (
      assetUrl: string,
      nested = false
    ): Promise<string | undefined> => {
      if (capturedByUrl.has(assetUrl)) {
        const existing = capturedByUrl.get(assetUrl)
        return existing ? (nested ? existing : `assets/${existing}`) : undefined
      }
      if (stored.length >= MAX_ASSETS) return undefined
      capturedByUrl.set(assetUrl, "")
      const response = await this.fetcher(assetUrl, {
        headers: { "User-Agent": "NewsPodcastArchive/0.1 (+self-hosted)" },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) return undefined
      let body = new Uint8Array(await response.arrayBuffer())
      if (body.byteLength > MAX_ASSET_BYTES) return undefined
      const assetType =
        response.headers.get("content-type") ?? "application/octet-stream"

      if (assetType.toLowerCase().startsWith("text/css")) {
        const css = new TextDecoder().decode(body)
        const rewritten = await rewriteCssUrls(css, assetUrl, async (url) => {
          try {
            return await capture(url, true)
          } catch {
            return undefined
          }
        })
        body = new TextEncoder().encode(rewritten)
      }

      const assetHash = hash(body)
      const key = `${prefix}/assets/${assetHash}${extension(assetType)}`
      await this.objects.put({ key, body, contentType: assetType })
      capturedByUrl.set(assetUrl, assetHash)
      stored.push({
        hash: assetHash,
        originalUrl: assetUrl,
        key,
        contentType: assetType,
        byteLength: body.byteLength,
      })
      return nested ? assetHash : `assets/${assetHash}`
    }

    for (const style of Array.from(document.querySelectorAll("style"))) {
      style.textContent = await rewriteCssUrls(
        style.textContent ?? "",
        sourceUrl,
        async (url) => {
          try {
            return await capture(url)
          } catch {
            return undefined
          }
        }
      )
    }
    for (const element of Array.from(document.querySelectorAll("[style]"))) {
      const css = element.getAttribute("style")
      if (!css) continue
      element.setAttribute(
        "style",
        await rewriteCssUrls(css, sourceUrl, async (url) => {
          try {
            return await capture(url)
          } catch {
            return undefined
          }
        })
      )
    }

    for (const candidate of candidates) {
      const rawUrl = candidate.element.getAttribute(candidate.attribute)
      if (!rawUrl || rawUrl.startsWith("data:")) continue
      try {
        const assetUrl = new URL(rawUrl, sourceUrl).href
        const localUrl = await capture(assetUrl)
        if (localUrl)
          candidate.element.setAttribute(candidate.attribute, localUrl)
        else candidate.element.removeAttribute(candidate.attribute)
      } catch {
        candidate.element.removeAttribute(candidate.attribute)
      }
    }
    return deduplicateAssets(stored)
  }
}

async function rewriteCssUrls(
  css: string,
  stylesheetUrl: string,
  capture: (url: string) => Promise<string | undefined>
): Promise<string> {
  const pattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi
  const matches = [...css.matchAll(pattern)]
  let result = css
  for (const match of matches) {
    const value = match[2]?.trim()
    if (!value || value.startsWith("data:") || value.startsWith("#")) continue
    try {
      const localUrl = await capture(new URL(value, stylesheetUrl).href)
      if (localUrl) result = result.replace(match[0], `url("${localUrl}")`)
    } catch {
      // Keep the original URL; replay CSP prevents an external request.
    }
  }
  return result
}

function sanitize(document: ReturnType<typeof parseHTML>["document"]): void {
  document
    .querySelectorAll(
      "script,noscript,iframe,object,embed,portal,meta[http-equiv='refresh'],link[rel~='modulepreload'],link[rel~='preload'],link[rel~='prefetch'],link[rel~='preconnect'],link[rel~='dns-prefetch']"
    )
    .forEach((element: Element) => element.remove())
  document.querySelectorAll("*").forEach((element: Element) => {
    for (const attribute of Array.from(element.attributes) as Attr[]) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name)
      }
    }
    element.removeAttribute("srcset")
  })
}

function normalizeNavigation(
  document: ReturnType<typeof parseHTML>["document"],
  sourceUrl: string
): void {
  document.querySelectorAll("a[href]").forEach((element: Element) => {
    const href = element.getAttribute("href")
    if (!href) return
    try {
      const absolute = new URL(href, sourceUrl)
      if (absolute.protocol === "http:" || absolute.protocol === "https:") {
        element.setAttribute("href", absolute.href)
        element.setAttribute("rel", "noreferrer")
      } else {
        element.removeAttribute("href")
      }
    } catch {
      element.removeAttribute("href")
    }
  })
}

function ensureBase(
  document: ReturnType<typeof parseHTML>["document"],
  sourceUrl: string
): void {
  const base = document.createElement("base")
  base.setAttribute("href", sourceUrl)
  document.head.insertBefore(base, document.head.firstChild)
}

function extractMarkdown(html: string, sourceUrl: string): string {
  const { document } = parseHTML(html)
  const article = new Readability(document as unknown as Document, {
    charThreshold: 0,
  }).parse()
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  })
  const title = article?.title?.trim() || new URL(sourceUrl).hostname
  const byline = article?.byline?.trim()
  const content = article?.content || document.body.innerHTML
  return [
    `# ${title}`,
    byline ? `\n- Author: ${byline}` : "",
    `\n- Source: ${sourceUrl}`,
    `\n${turndown.turndown(content).trim()}\n`,
  ].join("")
}

function addContentSecurityPolicy(html: string): string {
  const policy =
    "default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self'; form-action 'none'; base-uri 'none'"
  return html.replace(
    /<head(?:\s[^>]*)?>/i,
    (match) =>
      `${match}<meta http-equiv="Content-Security-Policy" content="${policy}">`
  )
}

function safeHeaders(headers: Headers): Record<string, string> {
  const allowed = new Set([
    "content-type",
    "content-language",
    "etag",
    "last-modified",
    "cache-control",
  ])
  const result: Record<string, string> = {}
  headers.forEach((value, name) => {
    if (allowed.has(name.toLowerCase())) result[name] = value
  })
  return result
}

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function extension(contentType: string): string {
  const type = contentType.split(";", 1)[0]?.trim().toLowerCase()
  return (
    {
      "text/css": ".css",
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/svg+xml": ".svg",
      "image/webp": ".webp",
      "image/x-icon": ".ico",
      "font/woff": ".woff",
      "font/woff2": ".woff2",
    }[type ?? ""] ?? ""
  )
}

function deduplicateAssets<T extends { hash: string }>(
  values: readonly T[]
): T[] {
  return [...new Map(values.map((value) => [value.hash, value])).values()]
}
