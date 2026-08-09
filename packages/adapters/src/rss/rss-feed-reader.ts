import { XMLParser } from "fast-xml-parser"

import type { RssSourceItem } from "@news-podcast/application"

export interface RssFeed {
  readonly name: string
  readonly feedUrl: string
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

  private async readOne(feed: RssFeed): Promise<readonly RssSourceItem[]> {
    let response: Response
    try {
      response = await this.fetcher(feed.feedUrl, {
        headers: { "User-Agent": "NewsPodcast/0.1 (+local)" },
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      throw new RssProviderError(
        `RSS request failed for ${feed.name}: ${error}`
      )
    }
    if (!response.ok) {
      throw new RssProviderError(
        `RSS request failed for ${feed.name} with ${response.status}`
      )
    }

    const document = this.parser.parse(await response.text()) as Record<
      string,
      unknown
    >
    const rawItems = rssItems(document)
    return rawItems.flatMap((raw) => {
      const item = raw as Record<string, unknown>
      const title = text(item.title)
      const link = atomLink(item.link) ?? text(item.link)
      if (!title || !link) return []
      try {
        const publishedAt = date(item.pubDate ?? item.published ?? item.updated)
        const description = text(
          item.description ?? item.summary ?? item.content
        )
        return [
          {
            sourceName: feed.name,
            title,
            url: new URL(link),
            ...(publishedAt ? { publishedAt } : {}),
            ...(description ? { description: stripMarkup(description) } : {}),
          },
        ]
      } catch {
        return []
      }
    })
  }
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
