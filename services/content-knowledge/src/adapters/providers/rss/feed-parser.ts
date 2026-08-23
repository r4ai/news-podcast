import { XMLParser } from "fast-xml-parser"
import { deepFreeze } from "@news-podcast/kernel"
import { createHash } from "node:crypto"

import type {
  FeedItem,
  FeedFetchError,
  FeedItemValidationFailure,
  FeedReadResult,
} from "../../../application/ports/article-catalog.js"
import type { FeedUrl } from "../../../domain/subscription.js"
import type { Sha256 } from "../../../domain/article.js"

type XmlObject = Readonly<Record<string, unknown>>

const failed = (): FeedFetchError =>
  deepFreeze({ _tag: "FeedFetchFailed" as const, reason: "MalformedResponse" })

const asObject = (value: unknown): XmlObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as XmlObject)
    : undefined

const asList = (value: unknown): readonly unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/** Extracts text from a parsed XML node without interpreting markup manually. */
const xmlText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number")
    return String(value)
  if (Array.isArray(value)) return value.map(xmlText).join(" ")
  const object = asObject(value)
  if (object === undefined) return ""
  return Object.entries(object)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, child]) => xmlText(child))
    .filter((child) => child !== "")
    .join(" ")
}

const textField = (node: XmlObject, name: string): string | undefined => {
  const value = xmlText(node[name]).trim()
  return value === "" ? undefined : value
}

const attribute = (node: XmlObject, name: string): string | undefined => {
  const value = xmlText(node[`@_${name}`]).trim()
  return value === "" ? undefined : value
}

/** Preserves element names, attributes, array order, and text deterministically. */
const canonicalXml = (value: unknown): unknown => {
  if (value === undefined || value === null) return null
  if (typeof value === "string" || typeof value === "number")
    return String(value)
  if (Array.isArray(value)) return value.map(canonicalXml)
  const object = asObject(value)
  if (object === undefined) return String(value)
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonicalXml(object[key])])
  )
}

const parseDate = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

const parseLink = (node: XmlObject): string | undefined => {
  const candidates = asList(node.link).flatMap((value) => {
    const object = asObject(value)
    if (object === undefined) {
      const text = xmlText(value).trim()
      return text === "" ? [] : [{ href: text, rel: undefined }]
    }
    const href = attribute(object, "href") ?? textField(object, "#text")
    return href === undefined
      ? []
      : [{ href, rel: attribute(object, "rel")?.toLowerCase() }]
  })
  const selected =
    candidates.find((candidate) => candidate.rel === "alternate") ??
    candidates.find((candidate) => candidate.rel === undefined) ??
    candidates.find((candidate) => candidate.rel !== "self")
  return selected?.href
}

const parserOptions = Object.freeze({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  htmlEntities: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  processEntities: {
    enabled: true,
    maxEntitySize: 8_192,
    maxExpansionDepth: 32,
    maxTotalExpansions: 1_000,
    maxExpandedLength: 1_048_576,
    maxEntityCount: 1_000,
  },
  isArray: (tagName: string) =>
    tagName === "item" || tagName === "entry" || tagName === "link",
})

const parseRootItems = (parsed: unknown): readonly unknown[] => {
  const document = asObject(parsed)
  if (document === undefined) throw failed()
  const rootName = Object.keys(document).find((name) => !name.startsWith("?"))
  const root = rootName === undefined ? undefined : asObject(document[rootName])
  if (root === undefined) throw failed()

  let items: unknown
  if (rootName === "rss") {
    const channel = asObject(root.channel)
    if (channel === undefined) throw failed()
    items = channel.item
  } else if (rootName === "RDF") {
    items = root.item
  } else if (rootName === "feed") {
    items = root.entry
  } else {
    throw failed()
  }

  return asList(items)
}

type ParsedItem =
  | Readonly<{ readonly _tag: "ValidItem"; readonly item: FeedItem }>
  | FeedItemValidationFailure

const invalidItem = (
  reason: FeedItemValidationFailure["reason"]
): FeedItemValidationFailure =>
  deepFreeze({ _tag: "FeedItemValidationFailed", reason })

const parseItem = (value: unknown, feedUrl: FeedUrl): ParsedItem => {
  const node = asObject(value)
  if (node === undefined) return invalidItem("InvalidItem")
  const title = textField(node, "title")
  if (title === undefined) return invalidItem("MissingTitle")
  if (title.length > 500) return invalidItem("TitleTooLong")
  const rawLink = parseLink(node)
  if (rawLink === undefined) return invalidItem("MissingLink")

  try {
    const url = new URL(rawLink, feedUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return invalidItem("InvalidUrl")
    url.hash = ""
    const externalId =
      textField(node, "guid") ??
      textField(node, "id") ??
      attribute(node, "about") ??
      url.href
    const explicitPublishedAt = parseDate(
      textField(node, "pubDate") ??
        textField(node, "published") ??
        textField(node, "date")
    )
    const updatedAt = parseDate(textField(node, "updated"))
    const publishedAt = explicitPublishedAt ?? updatedAt
    const captureFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          title,
          url: url.href,
          publishedAt: explicitPublishedAt ?? null,
          updatedAt: updatedAt ?? null,
          content: ["description", "content", "encoded", "summary"].map(
            (name) => ({ name, value: canonicalXml(node[name]) })
          ),
        })
      )
      .digest("hex") as Sha256
    return deepFreeze({
      _tag: "ValidItem" as const,
      item: deepFreeze({
        externalId: externalId.slice(0, 2_048),
        captureFingerprint,
        title,
        url: url.href,
        ...(publishedAt === undefined ? {} : { publishedAt }),
      }),
    })
  } catch {
    return invalidItem("InvalidUrl")
  }
}

export const parseRssFeed = (
  body: string,
  feedUrl: FeedUrl
): FeedReadResult => {
  try {
    const parser = new XMLParser(parserOptions)
    const parsed = parser.parse(body, true)
    const parsedItems = parseRootItems(parsed).map((item) =>
      parseItem(item, feedUrl)
    )
    return deepFreeze({
      items: parsedItems.flatMap((item) =>
        item._tag === "ValidItem" ? [item.item] : []
      ),
      failures: parsedItems.flatMap((item) =>
        item._tag === "FeedItemValidationFailed" ? [item] : []
      ),
    })
  } catch (error) {
    if (isFeedFetchError(error)) throw error
    throw failed()
  }
}

const isFeedFetchError = (value: unknown): value is FeedFetchError =>
  typeof value === "object" &&
  value !== null &&
  (value as { _tag?: unknown })._tag === "FeedFetchFailed"
