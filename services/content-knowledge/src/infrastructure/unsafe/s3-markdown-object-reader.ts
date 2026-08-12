import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  MarkdownObjectError,
  MarkdownObjectReader,
} from "../../application/article-catalog-ports.js"

export const MAXIMUM_MARKDOWN_BYTES = 1_048_576

export type S3MarkdownReaderConfig = DeepReadonly<{
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly timeoutMillis: number
}>

type UnsafeClient = Readonly<{
  readonly client: S3Client
  readonly close: () => void
}>

const failure = (reason: MarkdownObjectError["reason"]): MarkdownObjectError =>
  deepFreeze({ _tag: "MarkdownObjectFailed", reason })

const isMarkdownObjectError = (
  error: unknown
): error is MarkdownObjectError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "MarkdownObjectFailed"

const boundedBody = async (body: unknown): Promise<Uint8Array> => {
  if (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in body
  ) {
    const chunks: Uint8Array[] = []
    let length = 0
    for await (const input of body as AsyncIterable<unknown>) {
      const chunk =
        input instanceof Uint8Array
          ? input
          : typeof input === "string"
            ? new TextEncoder().encode(input)
            : undefined
      if (chunk === undefined) throw failure("CorruptObject")
      length += chunk.byteLength
      if (length > MAXIMUM_MARKDOWN_BYTES) throw failure("ResourceLimit")
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    const bytes = await body.transformToByteArray()
    if (!(bytes instanceof Uint8Array)) throw failure("CorruptObject")
    if (bytes.byteLength > MAXIMUM_MARKDOWN_BYTES)
      throw failure("ResourceLimit")
    return bytes
  }
  throw failure("CorruptObject")
}

export const openS3MarkdownObjectReaderUnsafe = (
  config: S3MarkdownReaderConfig,
  createClient: (config: S3MarkdownReaderConfig) => UnsafeClient = (input) => {
    const client = new S3Client({
      endpoint: input.endpoint,
      region: input.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      },
    })
    return Object.freeze({ client, close: () => client.destroy() })
  }
) => {
  const resource = createClient(config)
  const reader: MarkdownObjectReader = Object.freeze({
    read: (key) =>
      Effect.tryPromise({
        try: async (effectSignal) => {
          const timeout = new AbortController()
          const timer = setTimeout(() => timeout.abort(), config.timeoutMillis)
          timer.unref()
          const signal = AbortSignal.any([effectSignal, timeout.signal])
          try {
            const response = await resource.client.send(
            new GetObjectCommand({
              Bucket: config.bucket,
              Key: key,
            }),
              { abortSignal: signal }
            )
            if (
              response.ContentLength !== undefined &&
              response.ContentLength > MAXIMUM_MARKDOWN_BYTES
            )
              throw failure("ResourceLimit")
            if (
              response.ContentType !== undefined &&
              !response.ContentType.startsWith("text/markdown")
            )
              throw failure("CorruptObject")
            if (response.Body === undefined) throw failure("NotFound")
            const bytes = await boundedBody(response.Body)
            let markdown: string
            try {
              markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
            } catch {
              throw failure("CorruptObject")
            }
            if (!/\S/.test(markdown)) throw failure("CorruptObject")
            return markdown
          } finally {
            clearTimeout(timer)
          }
        },
        catch: (error) =>
          isMarkdownObjectError(error)
            ? error
            : typeof error === "object" &&
          error !== null &&
          "name" in error &&
          (error.name === "NoSuchKey" || error.name === "NotFound")
            ? failure("NotFound")
            : failure("Unavailable"),
      }),
  })
  return Object.freeze({
    reader,
    close: Effect.sync(resource.close).pipe(Effect.ignore),
  })
}
