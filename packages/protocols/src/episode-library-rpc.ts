import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

const uuid = <Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(name))

const boundedText = (maximum: number) =>
  Schema.NonEmptyString.check(
    Schema.isPattern(/\S/),
    Schema.isMaxLength(maximum)
  )

const UtcInstantSchema = Schema.String.check(
  Schema.makeFilter<string>(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString() === value
        ? undefined
        : "Expected a canonical UTC instant",
    { expected: "a canonical UTC instant" }
  )
).pipe(Schema.brand("LibraryUtcInstant"))

const HttpUrlSchema = Schema.String.check(
  Schema.makeFilter<string>(
    (value) => {
      try {
        const url = new URL(value)
        return (url.protocol === "http:" || url.protocol === "https:") &&
          url.username === "" &&
          url.password === ""
          ? undefined
          : "Expected an HTTP(S) URL without credentials"
      } catch {
        return "Expected an absolute HTTP(S) URL"
      }
    },
    { expected: "an absolute HTTP(S) URL without credentials" }
  )
).pipe(Schema.brand("LibraryHttpUrl"))

const EpisodeIdSchema = uuid("LibraryEpisodeId")
const SnapshotIdSchema = uuid("LibrarySnapshotId")
const ArticleIdSchema = uuid("LibraryArticleId")

const RssEpisodeSourceSchema = Schema.Struct({
  sourceKind: Schema.Literal("rss"),
  articleId: Schema.optional(ArticleIdSchema),
  url: HttpUrlSchema,
  title: boundedText(500),
  publishedAt: Schema.optional(UtcInstantSchema),
  snapshotId: SnapshotIdSchema,
})

const WebEpisodeSourceSchema = Schema.Struct({
  sourceKind: Schema.Literal("web"),
  url: HttpUrlSchema,
  title: boundedText(500),
})

export const LibraryEpisodeSummarySchema = Schema.Struct({
  id: EpisodeIdSchema,
  title: boundedText(500),
  createdAt: UtcInstantSchema,
})

export const LibraryEpisodeDetailSchema = Schema.Struct({
  id: EpisodeIdSchema,
  title: boundedText(500),
  script: boundedText(20_000),
  sources: Schema.NonEmptyArray(
    Schema.Union([RssEpisodeSourceSchema, WebEpisodeSourceSchema])
  ),
  createdAt: UtcInstantSchema,
})

/** Backward-compatible detail schema export; list items are summaries. */
export const LibraryEpisodeSchema = LibraryEpisodeDetailSchema

export const LibraryEpisodePageSchema = Schema.Struct({
  items: Schema.Array(LibraryEpisodeSummarySchema),
  page: Schema.Struct({
    hasMore: Schema.Boolean,
    nextCursor: Schema.optional(boundedText(1_000)),
  }),
})

export const ListEpisodesRequestSchema = Schema.Struct({
  cursor: Schema.optional(boundedText(1_000)),
})
export type ListEpisodesRequest = Schema.Schema.Type<
  typeof ListEpisodesRequestSchema
>
export const parseListEpisodesRequest = parse(ListEpisodesRequestSchema)

export const GetEpisodeRequestSchema = Schema.Struct({
  episodeId: EpisodeIdSchema,
})
export type GetEpisodeRequest = Schema.Schema.Type<
  typeof GetEpisodeRequestSchema
>
export const parseGetEpisodeRequest = parse(GetEpisodeRequestSchema)

export const CreateAudioAccessRequestSchema = Schema.Struct({
  episodeId: EpisodeIdSchema,
})
export type CreateAudioAccessRequest = Schema.Schema.Type<
  typeof CreateAudioAccessRequestSchema
>
export const parseCreateAudioAccessRequest = parse(
  CreateAudioAccessRequestSchema
)

export const EpisodeLibraryRejectionCodeSchema = Schema.Literals([
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "STORAGE_FAILURE",
  "SIGNING_FAILURE",
  "INTERNAL_ERROR",
])

export const EpisodeLibraryRejectionSchema = Schema.TaggedStruct("Rejected", {
  code: EpisodeLibraryRejectionCodeSchema,
})
export type EpisodeLibraryRejection = Schema.Schema.Type<
  typeof EpisodeLibraryRejectionSchema
>

export const ListEpisodesReplySchema = Schema.Union([
  Schema.TaggedStruct("Listed", { page: LibraryEpisodePageSchema }),
  EpisodeLibraryRejectionSchema,
])
export type ListEpisodesReply = Schema.Schema.Type<
  typeof ListEpisodesReplySchema
>
// During Web → Gateway → Library rollout, accept the prior fully validated
// list reply, then remove its detail fields before exposing a trusted summary.
// Emission continues to use the strict summary-only ListEpisodesReplySchema.
const CompatibleListEpisodesReplySchema = Schema.Union([
  ListEpisodesReplySchema,
  Schema.TaggedStruct("Listed", {
    page: Schema.Struct({
      items: Schema.Array(LibraryEpisodeDetailSchema),
      page: LibraryEpisodePageSchema.fields.page,
    }),
  }),
])
export const parseListEpisodesReply = (input: unknown) =>
  parse(CompatibleListEpisodesReplySchema)(input).pipe(
    Effect.map((reply): ListEpisodesReply =>
      reply._tag === "Rejected"
        ? reply
        : deepFreeze({
            _tag: "Listed",
            page: {
              items: reply.page.items.map(({ id, title, createdAt }) => ({
                id,
                title,
                createdAt,
              })),
              page: reply.page.page,
            },
          })
    )
  )

export const GetEpisodeReplySchema = Schema.Union([
  Schema.TaggedStruct("Found", { episode: LibraryEpisodeSchema }),
  Schema.TaggedStruct("NotFound", {}),
  EpisodeLibraryRejectionSchema,
])
export type GetEpisodeReply = Schema.Schema.Type<typeof GetEpisodeReplySchema>
export const parseGetEpisodeReply = parse(GetEpisodeReplySchema)

export const AudioAccessSchema = Schema.Struct({
  url: HttpUrlSchema,
  expiresAt: UtcInstantSchema,
})

export const CreateAudioAccessReplySchema = Schema.Union([
  Schema.TaggedStruct("Found", { access: AudioAccessSchema }),
  Schema.TaggedStruct("NotFound", {}),
  EpisodeLibraryRejectionSchema,
])
export type CreateAudioAccessReply = Schema.Schema.Type<
  typeof CreateAudioAccessReplySchema
>
export const parseCreateAudioAccessReply = parse(CreateAudioAccessReplySchema)
