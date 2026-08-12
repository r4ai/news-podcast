import { deepFreeze } from "@news-podcast/kernel"
import { Schema } from "effect"

const uuid = <Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(name))

const nonEmpty = <Name extends string>(name: Name) =>
  Schema.NonEmptyString.pipe(Schema.brand(name))

const utcInstant = <Name extends string>(name: Name) =>
  Schema.String.check(
    Schema.makeFilter(
      (value) => {
        try {
          return new Date(value).toISOString() === value
        } catch {
          return false
        }
      },
      { expected: "a canonical UTC instant" }
    )
  ).pipe(Schema.brand(name))

const httpUrl = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      try {
        const protocol = new URL(value).protocol
        return protocol === "https:" || protocol === "http:"
      } catch {
        return false
      }
    },
    { expected: "an absolute HTTP(S) URL" }
  )
).pipe(Schema.brand("HttpUrl"))

export const OwnerIdSchema = uuid("OwnerId")
export type OwnerId = Schema.Schema.Type<typeof OwnerIdSchema>

export const EpisodeIdSchema = uuid("EpisodeId")
export type EpisodeId = Schema.Schema.Type<typeof EpisodeIdSchema>

export const SnapshotIdSchema = uuid("SnapshotId")
export type SnapshotId = Schema.Schema.Type<typeof SnapshotIdSchema>

export const EpisodeTitleSchema = nonEmpty("EpisodeTitle")
export type EpisodeTitle = Schema.Schema.Type<typeof EpisodeTitleSchema>

export const EpisodeScriptSchema = nonEmpty("EpisodeScript")
export type EpisodeScript = Schema.Schema.Type<typeof EpisodeScriptSchema>

export const AudioObjectKeySchema = nonEmpty("AudioObjectKey")
export type AudioObjectKey = Schema.Schema.Type<typeof AudioObjectKeySchema>

export const HttpUrlSchema = httpUrl
export type HttpUrl = Schema.Schema.Type<typeof HttpUrlSchema>

export const UtcInstantSchema = utcInstant("UtcInstant")
export type UtcInstant = Schema.Schema.Type<typeof UtcInstantSchema>

export const RssSourceSchema = Schema.TaggedStruct("RssSource", {
  url: HttpUrlSchema,
  title: Schema.NonEmptyString,
  publishedAt: Schema.optionalKey(UtcInstantSchema),
  snapshotId: SnapshotIdSchema,
})
export type RssSource = Schema.Schema.Type<typeof RssSourceSchema>

export const WebSourceSchema = Schema.TaggedStruct("WebSource", {
  url: HttpUrlSchema,
  title: Schema.NonEmptyString,
})
export type WebSource = Schema.Schema.Type<typeof WebSourceSchema>

export const EpisodeSourceSchema = Schema.Union([
  RssSourceSchema,
  WebSourceSchema,
])
export type EpisodeSource = Schema.Schema.Type<typeof EpisodeSourceSchema>

export const StoredAudioSchema = Schema.Struct({
  objectKey: AudioObjectKeySchema,
  byteLength: Schema.Int.check(Schema.isGreaterThan(0)),
  contentType: Schema.Literals(["audio/wav", "audio/mpeg"]),
})
export type StoredAudio = Schema.Schema.Type<typeof StoredAudioSchema>

export const CompletedEpisodeSchema = Schema.TaggedStruct("CompletedEpisode", {
  id: EpisodeIdSchema,
  ownerId: OwnerIdSchema,
  title: EpisodeTitleSchema,
  script: EpisodeScriptSchema,
  audio: StoredAudioSchema,
  sources: Schema.NonEmptyArray(EpisodeSourceSchema),
  createdAt: UtcInstantSchema,
})
export type CompletedEpisode = Schema.Schema.Type<typeof CompletedEpisodeSchema>

export type PublicEpisode = Readonly<
  Omit<CompletedEpisode, "_tag" | "ownerId" | "audio">
>

export const toPublicEpisode = (episode: CompletedEpisode): PublicEpisode =>
  deepFreeze({
    id: episode.id,
    title: episode.title,
    script: episode.script,
    sources: episode.sources,
    createdAt: episode.createdAt,
  }) as PublicEpisode
