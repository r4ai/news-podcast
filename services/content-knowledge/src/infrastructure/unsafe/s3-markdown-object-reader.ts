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
}>

type UnsafeClient = Readonly<{
  readonly client: S3Client
  readonly close: () => void
}>

const failure = (reason: MarkdownObjectError["reason"]): MarkdownObjectError =>
  deepFreeze({ _tag: "MarkdownObjectFailed", reason })

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
        try: async () =>
          resource.client.send(
            new GetObjectCommand({
              Bucket: config.bucket,
              Key: key,
            })
          ),
        catch: (error) =>
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          (error.name === "NoSuchKey" || error.name === "NotFound")
            ? failure("NotFound")
            : failure("Unavailable"),
      }).pipe(
        Effect.flatMap((response) => {
          if (
            response.ContentLength !== undefined &&
            response.ContentLength > MAXIMUM_MARKDOWN_BYTES
          ) {
            return Effect.fail(failure("ResourceLimit"))
          }
          if (
            response.ContentType !== undefined &&
            !response.ContentType.startsWith("text/markdown")
          ) {
            return Effect.fail(failure("CorruptObject"))
          }
          if (response.Body === undefined)
            return Effect.fail(failure("NotFound"))
          return Effect.tryPromise({
            try: () => boundedBody(response.Body),
            catch: (error) =>
              typeof error === "object" && error !== null && "_tag" in error
                ? (error as MarkdownObjectError)
                : failure("Unavailable"),
          }).pipe(
            Effect.map((bytes) =>
              new TextDecoder("utf-8", { fatal: true }).decode(bytes)
            ),
            Effect.mapError((error) =>
              typeof error === "object" && error !== null && "_tag" in error
                ? (error as MarkdownObjectError)
                : failure("CorruptObject")
            ),
            Effect.filterOrFail(
              (markdown) => /\S/.test(markdown),
              () => failure("CorruptObject")
            )
          )
        })
      ),
  })
  return Object.freeze({
    reader,
    close: Effect.sync(resource.close).pipe(Effect.ignore),
  })
}
