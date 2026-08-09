import { XMLParser } from "fast-xml-parser"

import type { RssSourceItem } from "@news-podcast/application"

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
    const response = await this.fetch(feedUrl, "RSS feed")
    const document = this.parse(await response.text())
    const rss = document.rss as Record<string, unknown> | undefined
    const channel = rss?.channel as Record<string, unknown> | undefined
    const atom = document.feed as Record<string, unknown> | undefined
    const name =
      text(channel?.title ?? atom?.title) ?? new URL(feedUrl).hostname
    const siteUrl =
      atomLink(channel?.link ?? atom?.link) ??
      text(channel?.link ?? atom?.link) ??
      new URL(feedUrl).origin
    return {
      name,
      feedUrl,
      siteUrl,
      items: parseItems(document, name),
    }
  }

  private async readOne(feed: RssFeed): Promise<readonly RssSourceItem[]> {
    const response = await this.fetch(feed.feedUrl, feed.name)
    return parseItems(this.parse(await response.text()), feed.name)
  }

  private parse(value: string): Record<string, unknown> {
    return this.parser.parse(value) as Record<string, unknown>
  }

  private async fetch(url: string, name: string): Promise<Response> {
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
    return response
  }
}

function parseItems(
  document: Record<string, unknown>,
  sourceName: string
): readonly RssSourceItem[] {
  const rawItems = rssItems(document)
  return rawItems.flatMap((raw) => {
    const item = raw as Record<string, unknown>
    const title = text(item.title)
    const link = atomLink(item.link) ?? text(item.link)
    if (!title || !link) return []
    try {
      const publishedAt = date(item.pubDate ?? item.published ?? item.updated)
      const description = text(item.description ?? item.summary ?? item.content)
      return [
        {
          sourceName,
          title,
          url: new URL(link),
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
