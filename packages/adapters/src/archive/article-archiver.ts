import { createHash, randomUUID } from "node:crypto"

import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import postcss from "postcss"
import valueParser from "postcss-value-parser"
import TurndownService from "turndown"

import type { ObjectStore } from "@news-podcast/application"
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from "../config.js"
import { createSafeFetcher } from "../http/safe-fetch.js"

type CssValueNode = ReturnType<typeof valueParser>["nodes"][number]
const DISABLED_LINK_RELATIONS = new Set([
  "apple-touch-icon",
  "apple-touch-startup-image",
  "dns-prefetch",
  "expect",
  "icon",
  "manifest",
  "mask-icon",
  "modulepreload",
  "preconnect",
  "prefetch",
  "preload",
])

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
    fetcher: typeof fetch = fetch,
    private readonly limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS
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
    if (raw.byteLength > this.limits.maxHtmlBytes)
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
    const captureResult = await this.captureAssets(document, sourceUrl, prefix)
    document
      .querySelectorAll("base")
      .forEach((element: Element) => element.remove())
    if (captureResult.missingStylesheets > 0)
      replaceWithReaderView(document, sourceUrl)
    const replay = addContentSecurityPolicy(document)
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
      assets: captureResult.assets,
    }
  }

  private async captureAssets(
    document: ReturnType<typeof parseHTML>["document"],
    sourceUrl: string,
    prefix: string
  ) {
    const stylesheetCandidates = Array.from(document.querySelectorAll("link"))
      .filter(
        (element) =>
          getHtmlAttribute(element, "href") &&
          linkRelations(element).includes("stylesheet")
      )
      .map((element) => ({ element, attribute: "href" as const }))
    const passiveAssetCandidates: {
      element: Element
      attribute: "href" | "poster" | "src"
    }[] = []
    for (const tagName of ["img", "source", "audio", "video", "track"]) {
      document.querySelectorAll(tagName).forEach((element) => {
        if (getHtmlAttribute(element, "src"))
          passiveAssetCandidates.push({ element, attribute: "src" })
      })
    }
    document.querySelectorAll("input").forEach((element) => {
      if (
        asciiLowercase(getHtmlAttribute(element, "type") ?? "") === "image" &&
        getHtmlAttribute(element, "src")
      )
        passiveAssetCandidates.push({ element, attribute: "src" })
    })
    document.querySelectorAll("video").forEach((element) => {
      if (getHtmlAttribute(element, "poster"))
        passiveAssetCandidates.push({ element, attribute: "poster" })
    })
    for (const tagName of ["image", "use"]) {
      document.querySelectorAll(tagName).forEach((element) => {
        if (getHtmlAttribute(element, "href"))
          passiveAssetCandidates.push({ element, attribute: "href" })
      })
    }

    const stored: {
      hash: string
      originalUrl: string
      key: string
      contentType: string
      byteLength: number
    }[] = []
    const storedByHash = new Map<string, (typeof stored)[number]>()
    let totalStoredBytes = 0
    const capturedByUrl = new Map<
      string,
      { hash: string; contentType: string } | undefined
    >()
    const capture = async (
      assetUrl: string,
      nested = false,
      expectedContentType?: string
    ): Promise<string | undefined> => {
      if (capturedByUrl.has(assetUrl)) {
        const existing = capturedByUrl.get(assetUrl)
        if (
          !existing ||
          (expectedContentType &&
            !mediaTypeIs(existing.contentType, expectedContentType))
        )
          return undefined
        return nested ? existing.hash : `assets/${existing.hash}`
      }
      capturedByUrl.set(assetUrl, undefined)
      const response = await this.fetcher(assetUrl, {
        headers: { "User-Agent": "NewsPodcastArchive/0.1 (+self-hosted)" },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) return undefined
      let body = new Uint8Array(await response.arrayBuffer())
      if (body.byteLength > this.limits.maxAssetBytes) return undefined
      const assetType =
        response.headers.get("content-type") ?? "application/octet-stream"
      if (expectedContentType && !mediaTypeIs(assetType, expectedContentType))
        return undefined

      if (assetType.toLowerCase().startsWith("text/css")) {
        const css = new TextDecoder().decode(body)
        const rewritten = await rewriteCssUrls(
          css,
          assetUrl,
          async (url, nestedExpectedContentType) => {
            try {
              return await capture(url, true, nestedExpectedContentType)
            } catch {
              return undefined
            }
          }
        )
        body = new TextEncoder().encode(rewritten)
      }
      const assetHash = hash(body)
      const duplicate = storedByHash.get(assetHash)
      if (duplicate) {
        capturedByUrl.set(assetUrl, {
          hash: duplicate.hash,
          contentType: assetType,
        })
        return nested ? duplicate.hash : `assets/${duplicate.hash}`
      }
      if (
        stored.length >= this.limits.maxAssets ||
        totalStoredBytes + body.byteLength > this.limits.maxTotalAssetBytes
      )
        return undefined

      const key = `${prefix}/assets/${assetHash}${extension(assetType)}`
      await this.objects.put({ key, body, contentType: assetType })
      capturedByUrl.set(assetUrl, { hash: assetHash, contentType: assetType })
      totalStoredBytes += body.byteLength
      const storedAsset = {
        hash: assetHash,
        originalUrl: assetUrl,
        key,
        contentType: assetType,
        byteLength: body.byteLength,
      }
      stored.push(storedAsset)
      storedByHash.set(assetHash, storedAsset)
      return nested ? assetHash : `assets/${assetHash}`
    }

    const captureCandidate = async (
      candidate: {
        element: Element
        attribute: "href" | "poster" | "src"
      },
      expectedContentType?: string
    ) => {
      const rawUrl = getHtmlAttribute(candidate.element, candidate.attribute)
      if (!rawUrl || rawUrl.startsWith("data:")) return true
      try {
        const assetUrl = new URL(rawUrl, sourceUrl).href
        const localUrl = await capture(assetUrl, false, expectedContentType)
        if (localUrl)
          setHtmlAttribute(candidate.element, candidate.attribute, localUrl)
        else removeHtmlAttribute(candidate.element, candidate.attribute)
        return Boolean(localUrl)
      } catch {
        removeHtmlAttribute(candidate.element, candidate.attribute)
        return false
      }
    }

    // Linked stylesheets establish the page layout, so reserve the capture
    // budget for them before decorative inline assets and article images.
    let missingStylesheets = 0
    for (const candidate of stylesheetCandidates) {
      if (!(await captureCandidate(candidate, "text/css")))
        missingStylesheets += 1
    }

    for (const style of Array.from(document.querySelectorAll("style"))) {
      style.textContent = await rewriteCssUrls(
        style.textContent ?? "",
        sourceUrl,
        async (url, expectedContentType) => {
          try {
            return await capture(url, false, expectedContentType)
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
        await rewriteCssUrls(
          css,
          sourceUrl,
          async (url, expectedContentType) => {
            try {
              return await capture(url, false, expectedContentType)
            } catch {
              return undefined
            }
          },
          true
        )
      )
    }

    for (const element of Array.from(
      document.querySelectorAll("img[srcset],source[srcset]")
    )) {
      await rewriteSrcset(element, sourceUrl, capture)
    }

    for (const candidate of passiveAssetCandidates)
      await captureCandidate(candidate)
    return {
      assets: deduplicateAssets(stored),
      missingStylesheets,
    }
  }
}

async function rewriteSrcset(
  element: Element,
  sourceUrl: string,
  capture: (
    url: string,
    nested?: boolean,
    expectedContentType?: string
  ) => Promise<string | undefined>
): Promise<void> {
  const value = getHtmlAttribute(element, "srcset")
  if (!value) return
  const rewritten: string[] = []
  for (const candidate of parseSrcset(value)) {
    if (candidate.url.startsWith("data:")) {
      rewritten.push(formatSrcsetCandidate(candidate))
      continue
    }
    try {
      const localUrl = await capture(new URL(candidate.url, sourceUrl).href)
      if (localUrl)
        rewritten.push(formatSrcsetCandidate({ ...candidate, url: localUrl }))
    } catch {
      // Omit an invalid or unavailable candidate from the offline replay.
    }
  }
  if (rewritten.length > 0)
    setHtmlAttribute(element, "srcset", rewritten.join(", "))
  else removeHtmlAttribute(element, "srcset")
}

function parseSrcset(value: string): { url: string; descriptor: string }[] {
  const candidates: { url: string; descriptor: string }[] = []
  let position = 0
  while (position < value.length) {
    while (isHtmlSpace(value[position]) || value[position] === ",")
      position += 1
    if (position >= value.length) break

    const urlStart = position
    while (position < value.length && !isHtmlSpace(value[position]))
      position += 1
    let url = value.slice(urlStart, position)
    const endedWithComma = url.endsWith(",")
    if (endedWithComma) url = url.replace(/,+$/, "")

    let descriptor = ""
    if (!endedWithComma) {
      while (isHtmlSpace(value[position])) position += 1
      const descriptorStart = position
      while (position < value.length && value[position] !== ",") position += 1
      descriptor = value.slice(descriptorStart, position).trim()
    }
    if (position < value.length && value[position] === ",") position += 1
    if (url) candidates.push({ url, descriptor })
  }
  return candidates
}

function formatSrcsetCandidate(candidate: {
  url: string
  descriptor: string
}): string {
  return candidate.descriptor
    ? `${candidate.url} ${candidate.descriptor}`
    : candidate.url
}

function isHtmlSpace(value: string | undefined): boolean {
  return (
    value === "\u0009" ||
    value === "\u000a" ||
    value === "\u000c" ||
    value === "\u000d" ||
    value === "\u0020"
  )
}

function replaceWithReaderView(
  document: ReturnType<typeof parseHTML>["document"],
  sourceUrl: string
): void {
  const clone = parseHTML(document.toString()).document
  const article = new Readability(clone as unknown as Document, {
    charThreshold: 0,
  }).parse()
  if (!article?.content) return
  const articleTitle = article.title ?? new URL(sourceUrl).hostname

  document.documentElement.setAttribute("data-archive-view", "reader")
  document.head.innerHTML = ""
  const charset = document.createElement("meta")
  charset.setAttribute("charset", "utf-8")
  const viewport = document.createElement("meta")
  viewport.setAttribute("name", "viewport")
  viewport.setAttribute("content", "width=device-width, initial-scale=1")
  const title = document.createElement("title")
  title.textContent = articleTitle
  const style = document.createElement("style")
  style.textContent = READER_STYLE
  for (const element of [charset, viewport, title, style])
    document.head.appendChild(element)

  document.body.innerHTML = ""
  const main = document.createElement("main")
  const heading = document.createElement("h1")
  heading.textContent = articleTitle
  main.appendChild(heading)
  if (article.byline) {
    const byline = document.createElement("p")
    byline.className = "archive-byline"
    byline.textContent = article.byline
    main.appendChild(byline)
  }
  const source = document.createElement("p")
  source.className = "archive-source"
  const sourceLink = document.createElement("a")
  sourceLink.href = sourceUrl
  sourceLink.rel = "noreferrer"
  sourceLink.textContent = "元の記事を開く"
  source.appendChild(sourceLink)
  main.appendChild(source)
  const content = document.createElement("article")
  content.innerHTML = article.content
  main.appendChild(content)
  document.body.appendChild(main)
}

const READER_STYLE = `
  :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f7f7f5; color: #202124; line-height: 1.7; overflow-wrap: anywhere; }
  main { width: min(100% - 2rem, 52rem); margin: 0 auto; padding: 3rem clamp(1rem, 4vw, 3rem); background: #fff; min-height: 100vh; }
  h1 { margin: 0 0 1rem; font-size: clamp(2rem, 6vw, 3.25rem); line-height: 1.12; }
  h2, h3, h4 { line-height: 1.3; margin-top: 2em; }
  p, li { font-size: 1.05rem; }
  a { color: #075db7; text-underline-offset: 0.15em; }
  img, picture, video, svg, canvas { max-width: 100% !important; height: auto !important; }
  figure { margin: 2rem 0; }
  figcaption, .archive-byline, .archive-source { color: #5f6368; font-size: 0.9rem; }
  pre { max-width: 100%; overflow-x: auto; padding: 1rem; background: #f1f3f4; }
  blockquote { margin-inline: 0; padding-left: 1rem; border-left: 0.25rem solid #dadce0; color: #3c4043; }
  table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
  th, td { padding: 0.5rem; border: 1px solid #dadce0; }
  @media (max-width: 40rem) { main { width: 100%; padding-block: 1.5rem; } }
`

async function rewriteCssUrls(
  css: string,
  stylesheetUrl: string,
  capture: (
    url: string,
    expectedContentType?: string
  ) => Promise<string | undefined>,
  inline = false
): Promise<string> {
  try {
    const root = postcss.parse(inline ? `archive-root{${css}}` : css)
    const values: {
      value: string
      allowImportString: boolean
      update(value: string): void
    }[] = []
    root.walkDecls((declaration) => {
      values.push({
        value: declaration.value,
        allowImportString: false,
        update: (value) => {
          declaration.value = value
        },
      })
    })
    root.walkAtRules((atRule) => {
      if (asciiLowercase(atRule.name) === "import") {
        values.push({
          value: atRule.params,
          allowImportString: true,
          update: (value) => {
            atRule.params = value
          },
        })
      }
    })
    for (const value of values) {
      value.update(
        await rewriteCssValue(
          value.value,
          stylesheetUrl,
          capture,
          value.allowImportString
        )
      )
    }
    if (!inline) return root.toString()
    const rule = root.first
    if (!rule || rule.type !== "rule") return ""
    const declarations = rule.nodes.map((node) => node.toString()).join(";")
    return rule.raws.semicolon && declarations
      ? `${declarations};`
      : declarations
  } catch {
    return ""
  }
}

async function rewriteCssValue(
  value: string,
  stylesheetUrl: string,
  capture: (
    url: string,
    expectedContentType?: string
  ) => Promise<string | undefined>,
  allowImportString = false
): Promise<string> {
  const parsed = valueParser(value)
  const references: CssValueNode[] = []
  parsed.walk((node) => {
    if (node.type === "function" && asciiLowercase(node.value) === "url") {
      references.push(node)
      return false
    }
    return undefined
  })
  if (allowImportString) {
    const first = parsed.nodes.find(
      (node) => node.type !== "space" && node.type !== "comment"
    )
    if (first?.type === "string") references.push(first)
  }

  for (const reference of references) {
    const rawValue =
      reference.type === "function"
        ? simpleCssUrl(reference.nodes)
        : reference.value
    const localUrl = await captureCssReference(
      rawValue,
      stylesheetUrl,
      capture,
      allowImportString ? "text/css" : undefined
    )
    if (reference.type === "function") {
      reference.nodes = valueParser(`"${localUrl}"`).nodes
    } else if (reference.type === "string") {
      reference.value = localUrl
      reference.quote = '"'
    }
  }
  return valueParser.stringify(parsed.nodes)
}

function simpleCssUrl(nodes: CssValueNode[]): string | undefined {
  const values = nodes.filter(
    (node) => node.type !== "space" && node.type !== "comment"
  )
  const value = values[0]
  return values.length === 1 &&
    (value?.type === "string" || value?.type === "word")
    ? value.value
    : undefined
}

async function captureCssReference(
  value: string | undefined,
  stylesheetUrl: string,
  capture: (
    url: string,
    expectedContentType?: string
  ) => Promise<string | undefined>,
  expectedContentType?: string
): Promise<string> {
  if (!value || value.startsWith("data:") || value.startsWith("#"))
    return value ?? "data:,"
  try {
    return (
      (await capture(
        new URL(value, stylesheetUrl).href,
        expectedContentType
      )) ?? "data:,"
    )
  } catch {
    return "data:,"
  }
}

function mediaTypeIs(value: string, expected: string): boolean {
  return asciiLowercase(value.split(";", 1)[0]?.trim() ?? "") === expected
}

function sanitize(document: ReturnType<typeof parseHTML>["document"]): void {
  document
    .querySelectorAll("script,noscript,iframe,object,embed,portal")
    .forEach((element: Element) => element.remove())
  sanitizeLinkElements(document)
  document.querySelectorAll("meta").forEach((element: Element) => {
    const httpEquiv = asciiLowercase(
      getHtmlAttribute(element, "http-equiv") ?? ""
    )
    const name = asciiLowercase(getHtmlAttribute(element, "name") ?? "")
    if (
      httpEquiv === "refresh" ||
      name === "msapplication-tileimage" ||
      name === "msapplication-config"
    ) {
      element.remove()
    }
  })
  document.querySelectorAll("*").forEach((element: Element) => {
    for (const attribute of Array.from(element.attributes) as Attr[]) {
      if (asciiLowercase(attribute.name).startsWith("on")) {
        element.removeAttribute(attribute.name)
      }
    }
    for (const attribute of [
      "background",
      "crossorigin",
      "imagesrcset",
      "integrity",
      "nonce",
      "ping",
      "xlink:href",
    ]) {
      removeHtmlAttribute(element, attribute)
    }
  })
}

function sanitizeLinkElements(
  document: ReturnType<typeof parseHTML>["document"]
): void {
  document.querySelectorAll("link").forEach((element: Element) => {
    const relations = linkRelations(element)
    if (relations.includes("stylesheet")) {
      setHtmlAttribute(element, "rel", "stylesheet")
      return
    }
    if (relations.some((relation) => DISABLED_LINK_RELATIONS.has(relation)))
      element.remove()
  })
}

function linkRelations(element: Element): string[] {
  return spaceSeparatedTokens(getHtmlAttribute(element, "rel") ?? "").map(
    asciiLowercase
  )
}

function getHtmlAttribute(element: Element, name: string): string | null {
  const target = asciiLowercase(name)
  const attribute = Array.from(element.attributes).find(
    (candidate) => asciiLowercase(candidate.name) === target
  )
  return attribute?.value ?? null
}

function removeHtmlAttribute(element: Element, name: string): void {
  const target = asciiLowercase(name)
  for (const attribute of Array.from(element.attributes)) {
    if (asciiLowercase(attribute.name) === target)
      element.removeAttribute(attribute.name)
  }
}

function setHtmlAttribute(element: Element, name: string, value: string): void {
  removeHtmlAttribute(element, name)
  element.setAttribute(name, value)
}

function spaceSeparatedTokens(value: string): string[] {
  const tokens: string[] = []
  let token = ""
  for (const character of value) {
    if (
      character === "\u0009" ||
      character === "\u000a" ||
      character === "\u000c" ||
      character === "\u000d" ||
      character === "\u0020"
    ) {
      if (token) tokens.push(token)
      token = ""
    } else {
      token += character
    }
  }
  if (token) tokens.push(token)
  return tokens
}

function asciiLowercase(value: string): string {
  let result = ""
  for (const character of value) {
    const code = character.charCodeAt(0)
    result +=
      code >= 0x41 && code <= 0x5a
        ? String.fromCharCode(code + 0x20)
        : character
  }
  return result
}

export function prepareArchivedReplay(body: Uint8Array): Uint8Array {
  const { document } = parseHTML(new TextDecoder().decode(body))
  sanitize(document)
  document.querySelectorAll("meta").forEach((element: Element) => {
    if (
      asciiLowercase(getHtmlAttribute(element, "http-equiv") ?? "") ===
      "content-security-policy"
    ) {
      element.remove()
    }
  })
  return new TextEncoder().encode(document.toString())
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

function addContentSecurityPolicy(
  document: ReturnType<typeof parseHTML>["document"]
): string {
  const policy =
    "default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' data:; form-action 'none'; base-uri 'none'"
  const meta = document.createElement("meta")
  meta.setAttribute("http-equiv", "Content-Security-Policy")
  meta.setAttribute("content", policy)
  document.head.insertBefore(meta, document.head.firstChild)
  return document.toString()
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
