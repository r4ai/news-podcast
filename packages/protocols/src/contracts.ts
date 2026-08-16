import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

import { ActorSchema } from "./envelope.js"

const uuid = <Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(name))

const HttpUrlSchema = Schema.String.check(
  Schema.isPattern(/^https?:\/\/[^\s/$.?#].[^\s]*$/i)
).pipe(Schema.brand("HttpUrl"))

const OpaqueUserIdSchema = Schema.NonEmptyString.check(
  Schema.isPattern(/^\S+$/),
  Schema.isMaxLength(255)
).pipe(Schema.brand("UserId"))

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
).pipe(Schema.brand("UtcInstant"))

const ObjectKeySchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(1_024),
  Schema.isPattern(/^[\x21-\x7e]+$/),
  Schema.makeFilter<string>((value) => {
    const segments = value.split("/")
    return !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.includes("\\") &&
      !value.includes("//") &&
      segments.every((segment) => segment !== "." && segment !== "..")
      ? undefined
      : "Expected a normalized relative object key"
  })
).pipe(Schema.brand("ObjectKey"))

export const ResolveSessionResponseSchema = Schema.Struct({
  actor: ActorSchema,
})
export type ResolveSessionResponse = Schema.Schema.Type<
  typeof ResolveSessionResponseSchema
>
export const parseResolveSessionResponse = parse(ResolveSessionResponseSchema)

export const CreateEpisodeJobRequestSchema = Schema.Struct({
  idempotencyKey: Schema.NonEmptyString.check(Schema.isMaxLength(128)).pipe(
    Schema.brand("IdempotencyKey")
  ),
  trigger: Schema.Literal("manual"),
  articleIds: Schema.Array(uuid("ArticleId")).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(20)
  ),
})
export type CreateEpisodeJobRequest = Schema.Schema.Type<
  typeof CreateEpisodeJobRequestSchema
>
export const parseCreateEpisodeJobRequest = parse(CreateEpisodeJobRequestSchema)

const EpisodeSourceSchema = Schema.Struct({
  url: HttpUrlSchema,
  title: Schema.NonEmptyString,
})

export const EpisodeCompletedSchema = Schema.Struct({
  episodeId: uuid("EpisodeId"),
  ownerId: OpaqueUserIdSchema,
  audioObjectKey: Schema.NonEmptyString.check(
    Schema.isPattern(/^episodes\/[a-zA-Z0-9._/-]+$/)
  ).pipe(Schema.brand("AudioObjectKey")),
  title: Schema.NonEmptyString,
  sources: Schema.NonEmptyArray(EpisodeSourceSchema),
})
export type EpisodeCompleted = Schema.Schema.Type<typeof EpisodeCompletedSchema>
export const parseEpisodeCompleted = parse(EpisodeCompletedSchema)

const EpisodeCompletedV2SourceSchema = Schema.Struct({
  sourceKind: Schema.Literal("rss"),
  articleId: Schema.optional(uuid("ArticleId")),
  snapshotId: uuid("ArticleSnapshotId"),
  url: HttpUrlSchema,
  title: Schema.NonEmptyString.check(Schema.isMaxLength(500)),
  publishedAt: Schema.optional(UtcInstantSchema),
})

/**
 * Durable episode materialization contract. Unlike v1, this contains every
 * value the Library owns so consumers never have to read Production storage.
 */
export const EpisodeCompletedV2Schema = Schema.Struct({
  episodeId: uuid("EpisodeId"),
  ownerId: OpaqueUserIdSchema,
  title: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  script: Schema.NonEmptyString.check(Schema.isMaxLength(6_000)),
  audio: Schema.Struct({
    objectKey: ObjectKeySchema,
    byteLength: Schema.Int.check(Schema.isGreaterThan(0)),
    contentType: Schema.Literals(["audio/wav", "audio/mpeg"]),
  }),
  sources: Schema.NonEmptyArray(EpisodeCompletedV2SourceSchema).check(
    Schema.isMaxLength(20)
  ),
  completedAt: UtcInstantSchema,
})
export type EpisodeCompletedV2 = Schema.Schema.Type<
  typeof EpisodeCompletedV2Schema
>
export const parseEpisodeCompletedV2 = parse(EpisodeCompletedV2Schema)
