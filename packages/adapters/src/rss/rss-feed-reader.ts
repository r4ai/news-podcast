import { XMLParser } from "fast-xml-parser"

import type { RssSourceItem } from "@news-podcast/application"

const MAX_FEED_BYTES = 5 * 1024 * 1024

export interface RssFeed {
  readonly name: string
  readonly feedUrl: string
}

export interface DiscoveredFeed extends RssFeed {
  readonly siteUrl: string
  readonly items: readonly RssSourceItem[]
}

export class RssProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RssProviderError"
  }
}

export class RssFeedReader {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  })

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async read(feeds: readonly RssFeed[]): Promise<readonly RssSourceItem[]> {
    const groups = await Promise.all(feeds.map((feed) => this.readOne(feed)))
    return groups.flat()
  }

  async discover(feedUrl: string): Promise<DiscoveredFeed> {
    const document = this.parse(await this.fetchText(feedUrl, "RSS feed"))
    const rss = document.rss as Record<string, unknown> | undefined
    const channel = rss?.channel as Record<string, unknown> | undefined
    const atom = document.feed as Record<string, unknown> | undefined
    const name =
      text(channel?.title ?? atom?.title) ?? new URL(feedUrl).hostname
    const siteUrl =
      httpUrl(
        atomLink(channel?.link ?? atom?.link) ??
          text(channel?.link ?? atom?.link),
        feedUrl
      )?.href ?? new URL(feedUrl).origin
    return {
      name,
      feedUrl,
      siteUrl,
      items: parseItems(document, name, feedUrl),
    }
  }

  private async readOne(feed: RssFeed): Promise<readonly RssSourceItem[]> {
    return parseItems(
      this.parse(await this.fetchText(feed.feedUrl, feed.name)),
      feed.name,
      feed.feedUrl
    )
  }

  private parse(value: string): Record<string, unknown> {
    return this.parser.parse(value) as Record<string, unknown>
  }

  private async fetchText(url: string, name: string): Promise<string> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        headers: { "User-Agent": "NewsPodcast/0.1 (+self-hosted)" },
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      throw new RssProviderError(`RSS request failed for ${name}: ${error}`)
    }
    if (!response.ok) {
      throw new RssProviderError(
        `RSS request failed for ${name} with ${response.status}`
      )
    }
    const declaredLength = Number(response.headers.get("Content-Length"))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
      throw new RssProviderError(`RSS response exceeded 5 MiB for ${name}`)
    }
    try {
      return await readBoundedText(response, MAX_FEED_BYTES)
    } catch (error) {
      if (error instanceof RssProviderError) throw error
      throw new RssProviderError(`RSS response failed for ${name}: ${error}`)
    }
  }
}

function parseItems(
  document: Record<string, unknown>,
  sourceName: string,
  feedUrl: string
): readonly RssSourceItem[] {
  const rawItems = rssItems(document)
  return rawItems.flatMap((raw) => {
    const item = raw as Record<string, unknown>
    const title = text(item.title)
    const link = httpUrl(atomLink(item.link) ?? text(item.link), feedUrl)
    if (!title || !link) return []
    try {
      const publishedAt = date(item.pubDate ?? item.published ?? item.updated)
      const description = text(item.description ?? item.summary ?? item.content)
      return [
        {
          sourceName,
          title,
          url: link,
          ...(publishedAt ? { publishedAt } : {}),
          ...(description ? { description: stripMarkup(description) } : {}),
          ...(text(item.guid ?? item.id)
            ? { externalId: text(item.guid ?? item.id)! }
            : {}),
        },
      ]
    } catch {
      return []
    }
  })
}

function httpUrl(value: string | undefined, base: string): URL | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value, base)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined
  } catch {
    return undefined
  }
}

async function readBoundedText(
  response: Response,
  maximumBytes: number
): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maximumBytes) {
      await reader.cancel()
      throw new RssProviderError("RSS response exceeded 5 MiB")
    }
    chunks.push(value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function rssItems(document: Record<string, unknown>): readonly unknown[] {
  const rss = document.rss as Record<string, unknown> | undefined
  const channel = rss?.channel as Record<string, unknown> | undefined
  const feed = document.feed as Record<string, unknown> | undefined
  return array(channel?.item ?? feed?.entry)
}

function array(value: unknown): readonly unknown[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number") return String(value)
  if (value && typeof value === "object") {
    return text((value as Record<string, unknown>)["#text"])
  }
  return undefined
}

function atomLink(value: unknown): string | undefined {
  for (const candidate of array(value)) {
    if (!candidate || typeof candidate !== "object") continue
    const link = candidate as Record<string, unknown>
    if (!link["@_rel"] || link["@_rel"] === "alternate") {
      const href = text(link["@_href"])
      if (href) return href
    }
  }
  return undefined
}

function date(value: unknown): Date | undefined {
  const raw = text(value)
  if (!raw) return undefined
  const result = new Date(raw)
  return Number.isNaN(result.getTime()) ? undefined : result
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
