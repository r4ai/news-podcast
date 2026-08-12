import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Schema } from "effect"

const uuid = <Brand extends string>(brand: Brand) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(brand))

export const ArchiveRequestIdSchema = uuid("ArchiveRequestId")
export type ArchiveRequestId = Schema.Schema.Type<typeof ArchiveRequestIdSchema>

export const ArticleIdSchema = uuid("ArticleId")
export type ArticleId = Schema.Schema.Type<typeof ArticleIdSchema>

export const SnapshotIdSchema = uuid("SnapshotId")
export type SnapshotId = Schema.Schema.Type<typeof SnapshotIdSchema>

const canonicalHttpUrl = Schema.makeFilter<string>((input) => {
  try {
    const url = new URL(input)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "article URL must use HTTP or HTTPS"
    }
    if (url.username !== "" || url.password !== "") {
      return "article URL must not contain credentials"
    }
    if (url.hash !== "") {
      return "article URL must not contain a fragment"
    }
    return url.href === input || "article URL must be canonical"
  } catch {
    return "article URL must be absolute"
  }
})

export const ArticleUrlSchema = Schema.String.check(
  Schema.isMaxLength(2_048),
  canonicalHttpUrl
).pipe(Schema.brand("ArticleUrl"))
export type ArticleUrl = Schema.Schema.Type<typeof ArticleUrlSchema>

export const ArticleTitleSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(500)
).pipe(Schema.brand("ArticleTitle"))
export type ArticleTitle = Schema.Schema.Type<typeof ArticleTitleSchema>

const canonicalUtcInstant = Schema.makeFilter<string>((input) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)) {
    return "capturedAt must be a UTC ISO-8601 instant with milliseconds"
  }
  const timestamp = Date.parse(input)
  return (
    (Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString() === input) ||
    "capturedAt must be a real calendar instant"
  )
})

export const CapturedAtSchema = Schema.String.check(canonicalUtcInstant).pipe(
  Schema.brand("CapturedAt")
)
export type CapturedAt = Schema.Schema.Type<typeof CapturedAtSchema>

const safeObjectKey = Schema.makeFilter<string>((input) => {
  if (input.startsWith("/") || input.endsWith("/")) {
    return "object key must identify a relative object"
  }
  if (input.includes("\\") || input.includes("//")) {
    return "object key must use normalized forward-slash segments"
  }
  const segments = input.split("/")
  return (
    segments.every((segment) => segment !== "." && segment !== "..") ||
    "object key must not contain traversal segments"
  )
})

export const ObjectKeySchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(1_024),
  Schema.isPattern(/^[\x21-\x7e]+$/),
  safeObjectKey
).pipe(Schema.brand("ObjectKey"))
export type ObjectKey = Schema.Schema.Type<typeof ObjectKeySchema>

export const Sha256Schema = Schema.String.check(
  Schema.isPattern(/^[\da-f]{64}$/)
).pipe(Schema.brand("Sha256"))
export type Sha256 = Schema.Schema.Type<typeof Sha256Schema>

export const MediaTypeSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(3),
  Schema.isMaxLength(255),
  Schema.isPattern(
    /^[!#$%&'*+.^_`|~\w-]+\/[!#$%&'*+.^_`|~\w-]+(?:\s*;\s*[!#$%&'*+.^_`|~\w-]+=(?:[!#$%&'*+.^_`|~\w-]+|"[\x20-\x21\x23-\x7e]*"))*$/
  )
).pipe(Schema.brand("MediaType"))
export type MediaType = Schema.Schema.Type<typeof MediaTypeSchema>

const htmlMediaType = Schema.makeFilter<MediaType>(
  (input) =>
    input === "text/html" ||
    input === "text/html; charset=utf-8" ||
    "HTML artifact must use the canonical text/html media type"
)
const markdownMediaType = Schema.makeFilter<MediaType>(
  (input) =>
    input === "text/markdown" ||
    input === "text/markdown; charset=utf-8" ||
    "Markdown artifact must use the canonical text/markdown media type"
)

const archiveObjectFields = {
  key: ObjectKeySchema,
  sha256: Sha256Schema,
  mediaType: MediaTypeSchema,
  byteLength: Schema.Int.check(Schema.isGreaterThan(0)),
} as const

export const RawResponseObjectSchema = Schema.TaggedStruct("RawResponse", {
  ...archiveObjectFields,
  mediaType: MediaTypeSchema.check(htmlMediaType),
})
export type RawResponseObject = Schema.Schema.Type<
  typeof RawResponseObjectSchema
>

export const ReplayObjectSchema = Schema.TaggedStruct("Replay", {
  ...archiveObjectFields,
  mediaType: MediaTypeSchema.check(htmlMediaType),
})
export type ReplayObject = Schema.Schema.Type<typeof ReplayObjectSchema>

export const MarkdownObjectSchema = Schema.TaggedStruct("Markdown", {
  ...archiveObjectFields,
  mediaType: MediaTypeSchema.check(markdownMediaType),
})
export type MarkdownObject = Schema.Schema.Type<typeof MarkdownObjectSchema>

export const AssetObjectSchema = Schema.TaggedStruct(
  "Asset",
  archiveObjectFields
)
export type AssetObject = Schema.Schema.Type<typeof AssetObjectSchema>

const uniqueObjectKeys = Schema.makeFilter<{
  readonly rawResponse: RawResponseObject
  readonly replay: ReplayObject
  readonly markdown: MarkdownObject
  readonly assets: readonly AssetObject[]
}>((capture) => {
  const keys = [
    capture.rawResponse.key,
    capture.replay.key,
    capture.markdown.key,
    ...capture.assets.map((asset) => asset.key),
  ]
  return (
    new Set(keys).size === keys.length || "archive object keys must be unique"
  )
})

export const ArchiveCaptureSchema = Schema.Struct({
  rawResponse: RawResponseObjectSchema,
  replay: ReplayObjectSchema,
  markdown: MarkdownObjectSchema,
  assets: Schema.Array(AssetObjectSchema),
}).check(uniqueObjectKeys)
export type ArchiveCapture = Schema.Schema.Type<typeof ArchiveCaptureSchema>

export const ArchiveCommandSchema = Schema.Struct({
  archiveRequestId: ArchiveRequestIdSchema,
  articleId: ArticleIdSchema,
  sourceUrl: ArticleUrlSchema,
  title: ArticleTitleSchema,
})
export type ArchiveCommand = Schema.Schema.Type<typeof ArchiveCommandSchema>

export const ArticleSnapshotSchema = Schema.Struct({
  snapshotId: SnapshotIdSchema,
  archiveRequestId: ArchiveRequestIdSchema,
  articleId: ArticleIdSchema,
  sourceUrl: ArticleUrlSchema,
  title: ArticleTitleSchema,
  capturedAt: CapturedAtSchema,
  capture: ArchiveCaptureSchema,
})
export type ArticleSnapshot = Schema.Schema.Type<typeof ArticleSnapshotSchema>

export const ArticleArchivedSchema = Schema.TaggedStruct("ArticleArchived", {
  archiveRequestId: ArchiveRequestIdSchema,
  articleId: ArticleIdSchema,
  snapshotId: SnapshotIdSchema,
  sourceUrl: ArticleUrlSchema,
  title: ArticleTitleSchema,
  archivedAt: CapturedAtSchema,
  markdown: MarkdownObjectSchema,
})
export type ArticleArchived = Schema.Schema.Type<typeof ArticleArchivedSchema>

export const createArticleSnapshot = (input: {
  readonly command: ArchiveCommand
  readonly snapshotId: SnapshotId
  readonly capturedAt: CapturedAt
  readonly capture: ArchiveCapture
}): DeepReadonly<ArticleSnapshot> =>
  deepFreeze({
    snapshotId: input.snapshotId,
    archiveRequestId: input.command.archiveRequestId,
    articleId: input.command.articleId,
    sourceUrl: input.command.sourceUrl,
    title: input.command.title,
    capturedAt: input.capturedAt,
    capture: input.capture,
  })

export const createArticleArchived = (
  snapshot: ArticleSnapshot
): DeepReadonly<ArticleArchived> =>
  deepFreeze({
    _tag: "ArticleArchived" as const,
    archiveRequestId: snapshot.archiveRequestId,
    articleId: snapshot.articleId,
    snapshotId: snapshot.snapshotId,
    sourceUrl: snapshot.sourceUrl,
    title: snapshot.title,
    archivedAt: snapshot.capturedAt,
    markdown: snapshot.capture.markdown,
  })
