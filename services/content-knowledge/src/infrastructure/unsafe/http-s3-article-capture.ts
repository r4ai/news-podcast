import { createHash } from "node:crypto"

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

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

const captureArtifacts = (raw: Uint8Array, sourceUrl: string) => {
  return createArticleArchiveArtifacts(raw, sourceUrl)
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
          const artifacts = captureArtifacts(raw, sourceUrl)
          const prefix = `articles/${snapshotId}`
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
              body: artifacts.replay,
              mediaType: "text/html; charset=utf-8" as const,
            },
            {
              _tag: "Markdown" as const,
              key: `${prefix}/markdown/article.md`,
              body: artifacts.markdown,
              mediaType: "text/markdown; charset=utf-8" as const,
            },
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
              sha256: sha256(artifacts.replay),
              byteLength: artifacts.replay.byteLength,
            },
            markdown: {
              _tag: values[2]._tag,
              key: values[2].key,
              mediaType: values[2].mediaType,
              sha256: sha256(artifacts.markdown),
              byteLength: artifacts.markdown.byteLength,
            },
            assets: [],
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
