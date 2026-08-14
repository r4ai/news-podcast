import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  FeedFetchError,
  RssFeedReader,
} from "../application/article-catalog-ports.js"
import { parseRssFeed } from "./rss-feed-parser.js"

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
            return parseRssFeed(
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
