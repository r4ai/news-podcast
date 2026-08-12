import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

import { ActorSchema } from "./envelope.js"

const uuid = <Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(name))

const HttpUrlSchema = Schema.String.check(
  Schema.isPattern(/^https?:\/\/[^\s/$.?#].[^\s]*$/i)
).pipe(Schema.brand("HttpUrl"))

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
  trigger: Schema.Literals(["manual", "scheduled"]),
})
export type CreateEpisodeJobRequest = Schema.Schema.Type<
  typeof CreateEpisodeJobRequestSchema
>
export const parseCreateEpisodeJobRequest = parse(CreateEpisodeJobRequestSchema)

export const ArticleArchivedSchema = Schema.Struct({
  articleId: uuid("ArticleId"),
  snapshotId: uuid("ArticleSnapshotId"),
  canonicalUrl: HttpUrlSchema,
})
export type ArticleArchived = Schema.Schema.Type<typeof ArticleArchivedSchema>
export const parseArticleArchived = parse(ArticleArchivedSchema)

const EpisodeSourceSchema = Schema.Struct({
  url: HttpUrlSchema,
  title: Schema.NonEmptyString,
})

export const EpisodeCompletedSchema = Schema.Struct({
  episodeId: uuid("EpisodeId"),
  ownerId: uuid("OwnerId"),
  audioObjectKey: Schema.NonEmptyString.check(
    Schema.isPattern(/^episodes\/[a-zA-Z0-9._/-]+$/)
  ).pipe(Schema.brand("AudioObjectKey")),
  title: Schema.NonEmptyString,
  sources: Schema.NonEmptyArray(EpisodeSourceSchema),
})
export type EpisodeCompleted = Schema.Schema.Type<typeof EpisodeCompletedSchema>
export const parseEpisodeCompleted = parse(EpisodeCompletedSchema)
