import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type { FeedUrl } from "../domain/subscription.js"
import type {
  FeedFetchError,
  FeedItem,
  RssFeedReader,
} from "../application/article-catalog-ports.js"

export type {
  FeedFetchError,
  FeedItem,
  RssFeedReader,
} from "../application/article-catalog-ports.js"

export type HttpRssFeedReaderConfig = DeepReadonly<{
  readonly timeoutMillis: number
  readonly maximumBytes: number
}>

const failed = (reason: FeedFetchError["reason"]): FeedFetchError =>
  deepFreeze({ _tag: "FeedFetchFailed" as const, reason })

const decodeXml = (value: string): string =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")

const tag = (block: string, name: string): string | undefined => {
  const match = new RegExp(
    `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
    "i"
  ).exec(block)
  return match?.[1] === undefined
    ? undefined
    : decodeXml(match[1].replace(/<[^>]+>/g, " ")).trim() || undefined
}

const itemLink = (block: string): string | undefined => {
  const atom = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(block)?.[1]
  return atom === undefined ? tag(block, "link") : decodeXml(atom).trim()
}

const parseFeed = (body: string, feedUrl: FeedUrl): readonly FeedItem[] => {
  const isRss = /<rss\b/i.test(body) || /<channel\b/i.test(body)
  const isAtom = /<feed\b/i.test(body)
  if (!isRss && !isAtom) throw failed("MalformedResponse")
  const blocks = [
    ...body.matchAll(
      isAtom
        ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi
        : /<item\b[^>]*>([\s\S]*?)<\/item>/gi
    ),
  ]
  return deepFreeze(
    blocks.flatMap((match) => {
      const block = match[1] ?? ""
      const title = tag(block, "title")
      const rawLink = itemLink(block)
      if (title === undefined || title.length > 500 || rawLink === undefined)
        return []
      try {
        const url = new URL(rawLink, feedUrl)
        if (url.protocol !== "http:" && url.protocol !== "https:") return []
        url.hash = ""
        const externalId = tag(block, "guid") ?? tag(block, "id") ?? url.href
        const rawPublished =
          tag(block, "pubDate") ??
          tag(block, "published") ??
          tag(block, "updated")
        const publishedAt =
          rawPublished === undefined ? undefined : new Date(rawPublished)
        return [
          deepFreeze({
            externalId: externalId.slice(0, 2_048),
            title,
            url: url.href,
            ...(publishedAt !== undefined &&
            Number.isFinite(publishedAt.getTime())
              ? { publishedAt: publishedAt.toISOString() }
              : {}),
          }),
        ]
      } catch {
        return []
      }
    })
  )
}

const readBoundedText = async (
  response: Response,
  maximumBytes: number
): Promise<string> => {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maximumBytes)
    throw failed("ResourceLimit")
  if (response.body === null) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    length += chunk.value.byteLength
    if (length > maximumBytes) {
      await reader.cancel()
      throw failed("ResourceLimit")
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

const isFeedFailure = (value: unknown): value is FeedFetchError =>
  typeof value === "object" &&
  value !== null &&
  (value as { _tag?: unknown })._tag === "FeedFetchFailed"

export const createHttpRssFeedReader = (
  config: HttpRssFeedReaderConfig,
  fetcher: typeof fetch = fetch
): RssFeedReader =>
  deepFreeze({
    read: (url) =>
      Effect.tryPromise({
        try: async (effectSignal) => {
          const timeout = new AbortController()
          const timer = setTimeout(() => timeout.abort(), config.timeoutMillis)
          timer.unref()
          try {
            const response = await fetcher(url, {
              headers: { "User-Agent": "NewsPodcast/0.1 (+self-hosted)" },
              redirect: "error",
              signal: AbortSignal.any([effectSignal, timeout.signal]),
            })
            if (!response.ok) throw failed("HttpStatus")
            return parseFeed(
              await readBoundedText(response, config.maximumBytes),
              url
            )
          } catch (error) {
            if (isFeedFailure(error)) throw error
            if (effectSignal.aborted) throw failed("Canceled")
            if (timeout.signal.aborted) throw failed("Timeout")
            throw failed("Unavailable")
          } finally {
            clearTimeout(timer)
          }
        },
        catch: (error) =>
          isFeedFailure(error) ? error : failed("Unavailable"),
      }),
  })
