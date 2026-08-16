import { createHash } from "node:crypto"

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"
import { JSDOM } from "jsdom"
import postcss, { type Root } from "postcss"

import type {
  ArchiveArticlePorts,
  CaptureError,
} from "../../application/ports/archive.js"
import { ArchiveCaptureSchema } from "../../domain/article.js"
import { createArticleArchiveArtifacts } from "./article-markdown-parser.js"
import { createNodeSafeFetcher } from "./safe-fetch.js"

export type HttpS3ArticleCaptureConfig = DeepReadonly<{
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly timeoutMillis: number
  readonly maximumHtmlBytes: number
  readonly maximumAssetBytes?: number
  readonly maximumAssetCount?: number
  readonly maximumAssetTotalBytes?: number
}>

type S3Resource = Readonly<{
  readonly client: S3Client
  readonly close: () => void
}>
type SafeFetchResource = Readonly<{
  readonly fetch: typeof fetch
  readonly close: () => Promise<void>
}>

export type HttpS3ArticleCaptureDependencies = Readonly<{
  readonly createS3: (config: HttpS3ArticleCaptureConfig) => S3Resource
  readonly createSafeFetch: () => SafeFetchResource
}>

export type HttpS3ArticleCaptureResource = Readonly<{
  readonly capture: ArchiveArticlePorts["capture"]
  /** The same DNS-pinned fetch boundary is reused by the RSS reader. */
  readonly fetcher: typeof fetch
  readonly close: Effect.Effect<void>
}>

const defaultDependencies: HttpS3ArticleCaptureDependencies = Object.freeze({
  createS3: (config) => {
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
    return Object.freeze({ client, close: () => client.destroy() })
  },
  createSafeFetch: createNodeSafeFetcher,
})

const failure = (reason: CaptureError["reason"]): CaptureError =>
  deepFreeze({ _tag: "CaptureFailed", reason })
const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex")

const readBounded = async (
  response: Response,
  maximumBytes: number
): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maximumBytes)
    throw failure("ResourceLimit")
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    length += chunk.value.byteLength
    if (length > maximumBytes) {
      await reader.cancel()
      throw failure("ResourceLimit")
    }
    chunks.push(chunk.value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const captureArtifacts = async (raw: Uint8Array, sourceUrl: string) => {
  return createArticleArchiveArtifacts(raw, sourceUrl)
}

type CapturedAsset = Readonly<{
  url: string
  key: string
  body: Uint8Array
  mediaType: string
}>

type FetchedAsset = Readonly<{
  url: string
  body: Uint8Array
  mediaType: string
}>

const extensionFor = (mediaType: string): string =>
  ({
    "text/css": "css",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "font/woff": "woff",
    "font/woff2": "woff2",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "video/mp4": "mp4",
  })[mediaType] ?? "bin"

const canonicalMediaType = (response: Response): string => {
  const value = response.headers.get("content-type")?.split(";", 1)[0]?.trim()
  if (value === undefined) return "application/octet-stream"
  const tokenCharacters =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'*+-.^_`|~"
  const slash = value.indexOf("/")
  const valid =
    slash > 0 &&
    slash === value.lastIndexOf("/") &&
    slash < value.length - 1 &&
    [...value].every(
      (character, index) =>
        index === slash || tokenCharacters.includes(character)
    )
  return valid ? value.toLowerCase() : "application/octet-stream"
}

const resourceUrl = (value: string, base: string): string | undefined => {
  try {
    const url = new URL(value, base)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

const whitespace = new Set([" ", "\n", "\r", "\t", "\f"])
const splitWhitespace = (value: string): readonly string[] => {
  const parts: string[] = []
  let current = ""
  for (const character of value) {
    if (whitespace.has(character)) {
      if (current !== "") parts.push(current)
      current = ""
    } else current += character
  }
  if (current !== "") parts.push(current)
  return parts
}

const stripCssString = (value: string): string => {
  const trimmed = value.trim()
  const first = trimmed[0]
  return (first === '"' || first === "'") && trimmed.at(-1) === first
    ? trimmed.slice(1, -1)
    : trimmed
}

const transformCssUrls = (
  value: string,
  transform: (url: string) => string | undefined
): string => {
  let output = ""
  let cursor = 0
  const lower = value.toLowerCase()
  for (;;) {
    const start = lower.indexOf("url(", cursor)
    if (start < 0) return output + value.slice(cursor)
    let index = start + 4
    while (whitespace.has(value[index] ?? "")) index += 1
    const quote =
      value[index] === '"' || value[index] === "'" ? value[index++] : undefined
    const valueStart = index
    let valueEnd: number
    if (quote === undefined) {
      while (index < value.length && value[index] !== ")") index += 1
      valueEnd = index
    } else {
      while (index < value.length && value[index] !== quote) index += 1
      valueEnd = index
      if (value[index] === quote) index += 1
      while (whitespace.has(value[index] ?? "")) index += 1
    }
    if (value[index] !== ")") return output + value.slice(cursor)
    const raw = value.slice(valueStart, valueEnd).trim()
    const replacement = transform(raw)
    output += value.slice(cursor, start)
    output += replacement === undefined ? "url()" : `url("${replacement}")`
    cursor = index + 1
  }
}

const parseCss = (css: string, inline: boolean): Root | undefined => {
  try {
    return postcss.parse(inline ? `archive-root{${css}}` : css)
  } catch {
    return undefined
  }
}

const importString = (params: string): string | undefined => {
  const trimmed = params.trim()
  const quote = trimmed[0]
  if (quote !== '"' && quote !== "'") return undefined
  const end = trimmed.indexOf(quote, 1)
  return end < 0 ? undefined : trimmed.slice(1, end)
}

const cssResourceUrls = (
  css: string,
  base: string,
  inline = false
): readonly string[] => {
  const root = parseCss(css, inline)
  if (root === undefined) return []
  const values: string[] = []
  const collect = (value: string) =>
    transformCssUrls(value, (candidate) => {
      values.push(candidate)
      return candidate
    })
  root.walkDecls((declaration) => void collect(declaration.value))
  root.walkAtRules("import", (rule) => {
    const direct = importString(rule.params)
    if (direct !== undefined) values.push(direct)
    else collect(rule.params)
  })
  return [
    ...new Set(
      values.flatMap((value) => {
        const url = resourceUrl(stripCssString(value), base)
        return url === undefined ? [] : [url]
      })
    ),
  ]
}

const rewriteCss = (
  css: string,
  base: string,
  inline: boolean,
  resolve: (url: string) => string | undefined
): string => {
  const root = parseCss(css, inline)
  if (root === undefined) return ""
  const rewrite = (value: string) =>
    transformCssUrls(value, (candidate) => {
      const url = resourceUrl(stripCssString(candidate), base)
      return url === undefined ? undefined : resolve(url)
    })
  root.walkDecls(
    (declaration) => void (declaration.value = rewrite(declaration.value))
  )
  root.walkAtRules("import", (rule) => {
    const direct = importString(rule.params)
    if (direct === undefined) rule.params = rewrite(rule.params)
    else {
      const url = resourceUrl(direct, base)
      const replacement = url === undefined ? undefined : resolve(url)
      rule.params = replacement === undefined ? "" : `"${replacement}"`
    }
  })
  if (!inline) return root.toString()
  const wrapper = root.first
  return wrapper !== undefined &&
    "nodes" in wrapper &&
    wrapper.nodes !== undefined
    ? wrapper.nodes.map((node) => node.toString()).join(";")
    : ""
}

const assetReplayPath = (asset: CapturedAsset): string =>
  `../assets/${asset.key.split("/").at(-1)!}`

const assetCssPath = (asset: CapturedAsset): string =>
  `./${asset.key.split("/").at(-1)!}`

/** Captures the initial static dependency graph without executing page code. */
const captureReplay = async (input: {
  raw: Uint8Array
  sourceUrl: string
  prefix: string
  fallbackReplay: Uint8Array
  fetcher: typeof fetch
  signal: AbortSignal
  maximumAssetBytes: number
  maximumAssetCount: number
  maximumAssetTotalBytes: number
}): Promise<{ replay: Uint8Array; assets: readonly CapturedAsset[] }> => {
  const html = new TextDecoder().decode(input.raw)
  const dom = new JSDOM(html, { url: input.sourceUrl })
  const document = dom.window.document
  document
    .querySelectorAll("script, iframe, frame, object, embed, form, base")
    .forEach((element) => element.remove())
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  const references: Array<{
    url: string
    required: boolean
    rewrite: (path: string | undefined) => void
  }> = []
  const addAttribute = (
    selector: string,
    attribute: string,
    required = false
  ) => {
    for (const element of document.querySelectorAll(selector)) {
      const value = element.getAttribute(attribute)
      const url =
        value === null ? undefined : resourceUrl(value, input.sourceUrl)
      if (url === undefined) {
        element.removeAttribute(attribute)
        continue
      }
      references.push({
        url,
        required,
        rewrite: (path) => {
          if (path === undefined) {
            element.removeAttribute(attribute)
            return
          }
          element.setAttribute(attribute, path)
          if (required) element.removeAttribute("integrity")
        },
      })
    }
  }
  addAttribute('link[rel~="stylesheet"]', "href", true)
  addAttribute('link[rel~="icon"]', "href")
  addAttribute("img[src], source[src], audio[src], video[src]", "src")
  addAttribute("video[poster]", "poster")

  const srcsets: Array<{
    element: Element
    candidates: readonly Readonly<{ url: string; descriptor: string }>[]
  }> = []
  for (const element of document.querySelectorAll(
    "img[srcset], source[srcset]"
  )) {
    const candidates = (element.getAttribute("srcset") ?? "")
      .split(",")
      .flatMap((candidate) => {
        const [value, ...descriptor] = splitWhitespace(candidate.trim())
        const url =
          value === undefined ? undefined : resourceUrl(value, input.sourceUrl)
        return url === undefined
          ? []
          : [{ url, descriptor: descriptor.join(" ") }]
      })
    if (candidates.length === 0) element.removeAttribute("srcset")
    else srcsets.push({ element, candidates })
  }

  const inlineCss: Array<{ element: Element; attribute?: "style" }> = [
    ...[...document.querySelectorAll("style")].map((element) => ({ element })),
    ...[...document.querySelectorAll("[style]")].map((element) => ({
      element,
      attribute: "style" as const,
    })),
  ]

  const maximumCount = input.maximumAssetCount
  const stylesheetUrls = references
    .filter(({ required }) => required)
    .map(({ url }) => url)
  const inlineCssUrls = inlineCss.flatMap(({ element, attribute }) =>
    cssResourceUrls(
      attribute === "style"
        ? (element.getAttribute(attribute) ?? "")
        : (element.textContent ?? ""),
      input.sourceUrl,
      attribute === "style"
    )
  )
  const remainingUrls = [
    ...references.filter(({ required }) => !required).map(({ url }) => url),
    ...srcsets.flatMap(({ candidates }) => candidates.map(({ url }) => url)),
  ]
  const queued = [
    ...new Set([...stylesheetUrls, ...inlineCssUrls, ...remainingUrls]),
  ]
  const fetched = new Map<string, FetchedAsset>()
  const countedDigests = new Set<string>()
  let totalBytes = 0
  let requiredFailure = false
  for (let index = 0; index < queued.length; index += 1) {
    const url = queued[index]!
    try {
      const response = await input.fetcher(url, {
        headers: { "User-Agent": "NewsPodcastArchive/0.1 (+self-hosted)" },
        signal: input.signal,
      })
      if (!response.ok) throw new Error("asset response failed")
      const body = await readBounded(response, input.maximumAssetBytes)
      const digest = sha256(body)
      if (!countedDigests.has(digest)) {
        if (countedDigests.size >= maximumCount) throw failure("ResourceLimit")
        totalBytes += body.byteLength
      }
      if (totalBytes > input.maximumAssetTotalBytes)
        throw failure("ResourceLimit")
      countedDigests.add(digest)
      const mediaType = canonicalMediaType(response)
      fetched.set(url, {
        url,
        body,
        mediaType,
      })
      if (mediaType === "text/css") {
        const css = new TextDecoder().decode(body)
        let insertionIndex = index + 1
        for (const nested of cssResourceUrls(css, url)) {
          if (!queued.includes(nested))
            queued.splice(insertionIndex++, 0, nested)
        }
      }
    } catch (error) {
      if (isCaptureError(error) && error.reason === "ResourceLimit") throw error
      if (
        references.some(
          (reference) => reference.url === url && reference.required
        )
      ) {
        requiredFailure = true
      }
    }
  }

  if (requiredFailure) {
    dom.window.close()
    return { replay: input.fallbackReplay, assets: [] }
  }

  const materialized = new Map<string, CapturedAsset>()
  const visiting = new Set<string>()
  const materialize = (url: string): CapturedAsset | undefined => {
    const cached = materialized.get(url)
    if (cached !== undefined) return cached
    const source = fetched.get(url)
    if (source === undefined || visiting.has(url)) return undefined
    visiting.add(url)
    let body = source.body
    if (source.mediaType === "text/css") {
      const css = rewriteCss(
        new TextDecoder().decode(body),
        url,
        false,
        (nestedUrl) => {
          const nested = materialize(nestedUrl)
          return nested === undefined ? undefined : assetCssPath(nested)
        }
      )
      body = new TextEncoder().encode(css)
    }
    visiting.delete(url)
    const digest = sha256(body)
    const asset = {
      url,
      key: `${input.prefix}/assets/${digest}.${extensionFor(source.mediaType)}`,
      body,
      mediaType: source.mediaType,
    }
    materialized.set(url, asset)
    return asset
  }
  for (const url of queued) materialize(url)

  for (const reference of references) {
    const asset = materialized.get(reference.url)
    reference.rewrite(asset === undefined ? undefined : assetReplayPath(asset))
  }
  for (const { element, candidates } of srcsets) {
    const rewritten = candidates.flatMap(({ url, descriptor }) => {
      const asset = materialized.get(url)
      return asset === undefined
        ? []
        : [
            `${assetReplayPath(asset)}${descriptor === "" ? "" : ` ${descriptor}`}`,
          ]
    })
    if (rewritten.length === 0) element.removeAttribute("srcset")
    else element.setAttribute("srcset", rewritten.join(", "))
  }
  for (const { element, attribute } of inlineCss) {
    const original =
      attribute === "style"
        ? (element.getAttribute(attribute) ?? "")
        : (element.textContent ?? "")
    const rewritten = rewriteCss(
      original,
      input.sourceUrl,
      attribute === "style",
      (url) => {
        const asset = materialized.get(url)
        return asset === undefined ? undefined : assetReplayPath(asset)
      }
    )
    if (attribute === "style") element.setAttribute(attribute, rewritten)
    else element.textContent = rewritten
  }
  const meta = document.createElement("meta")
  meta.httpEquiv = "Content-Security-Policy"
  meta.content =
    "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self'"
  document.head?.prepend(meta)
  const replay = new TextEncoder().encode(dom.serialize())
  dom.window.close()
  const uniqueAssets = new Map(
    [...materialized.values()].map((asset) => [asset.key, asset] as const)
  )
  return { replay, assets: [...uniqueAssets.values()] }
}

const isCaptureError = (error: unknown): error is CaptureError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "CaptureFailed"

const blockedFetchFailure = (error: unknown): boolean =>
  error instanceof Error &&
  ["private", "reserved", "allowed", "credentials", "redirect"].some((term) =>
    error.message.toLowerCase().includes(term)
  )

/** Owns the Node DNS-pinned fetcher and S3 client used by RSS and article capture. */
export const openHttpS3ArticleCaptureUnsafe = (
  config: HttpS3ArticleCaptureConfig,
  dependencies: HttpS3ArticleCaptureDependencies = defaultDependencies
): HttpS3ArticleCaptureResource => {
  const s3 = dependencies.createS3(config)
  const safe = dependencies.createSafeFetch()
  const capture: ArchiveArticlePorts["capture"] = ({ sourceUrl, snapshotId }) =>
    Effect.tryPromise({
      try: async (effectSignal) => {
        const timeout = new AbortController()
        const timer = setTimeout(() => timeout.abort(), config.timeoutMillis)
        timer.unref()
        const signal = AbortSignal.any([effectSignal, timeout.signal])
        try {
          const response = await safe.fetch(sourceUrl, {
            headers: { "User-Agent": "NewsPodcastArchive/0.1 (+self-hosted)" },
            signal,
          })
          if (!response.ok) throw failure("Unavailable")
          const contentType =
            response.headers.get("content-type")?.toLowerCase() ?? ""
          if (!contentType.includes("text/html"))
            throw failure("MalformedResponse")
          const raw = await readBounded(response, config.maximumHtmlBytes)
          const artifacts = await captureArtifacts(raw, sourceUrl)
          const prefix = `articles/${snapshotId}`
          const replayCapture = await captureReplay({
            raw,
            sourceUrl,
            prefix,
            fallbackReplay: artifacts.replay,
            fetcher: safe.fetch,
            signal,
            maximumAssetBytes: config.maximumAssetBytes ?? 20 * 1_024 * 1_024,
            maximumAssetCount: config.maximumAssetCount ?? 512,
            maximumAssetTotalBytes:
              config.maximumAssetTotalBytes ?? 100 * 1_024 * 1_024,
          })
          const values = [
            {
              _tag: "RawResponse" as const,
              key: `${prefix}/raw/response.html`,
              body: raw,
              mediaType: "text/html" as const,
            },
            {
              _tag: "Replay" as const,
              key: `${prefix}/replay/index.html`,
              body: replayCapture.replay,
              mediaType: "text/html; charset=utf-8" as const,
            },
            {
              _tag: "Markdown" as const,
              key: `${prefix}/markdown/article.md`,
              body: artifacts.markdown,
              mediaType: "text/markdown; charset=utf-8" as const,
            },
            ...replayCapture.assets.map((asset) => ({
              _tag: "Asset" as const,
              key: asset.key,
              body: asset.body,
              mediaType: asset.mediaType,
            })),
          ]
          await Promise.all(
            values.map((value) =>
              s3.client.send(
                new PutObjectCommand({
                  Bucket: config.bucket,
                  Key: value.key,
                  Body: value.body,
                  ContentLength: value.body.byteLength,
                  ContentType: value.mediaType,
                }),
                { abortSignal: signal }
              )
            )
          )
          return parse(ArchiveCaptureSchema)({
            rawResponse: {
              _tag: values[0]._tag,
              key: values[0].key,
              mediaType: values[0].mediaType,
              sha256: sha256(raw),
              byteLength: raw.byteLength,
            },
            replay: {
              _tag: values[1]._tag,
              key: values[1].key,
              mediaType: values[1].mediaType,
              sha256: sha256(replayCapture.replay),
              byteLength: replayCapture.replay.byteLength,
            },
            markdown: {
              _tag: values[2]._tag,
              key: values[2].key,
              mediaType: values[2].mediaType,
              sha256: sha256(artifacts.markdown),
              byteLength: artifacts.markdown.byteLength,
            },
            assets: values.slice(3).map((value) => ({
              _tag: "Asset" as const,
              key: value.key,
              mediaType: value.mediaType,
              sha256: sha256(value.body),
              byteLength: value.body.byteLength,
            })),
          }).pipe(Effect.mapError(() => failure("MalformedResponse")))
        } catch (error) {
          if (isCaptureError(error)) throw error
          if (blockedFetchFailure(error)) throw failure("Blocked")
          throw failure("Unavailable")
        } finally {
          clearTimeout(timer)
        }
      },
      catch: (error) =>
        isCaptureError(error) ? error : failure("Unavailable"),
    }).pipe(Effect.flatten)

  return Object.freeze({
    capture,
    fetcher: safe.fetch,
    close: Effect.all([
      Effect.tryPromise(() => safe.close()).pipe(Effect.ignore),
      Effect.sync(s3.close).pipe(Effect.ignore),
    ]).pipe(Effect.asVoid),
  })
}
