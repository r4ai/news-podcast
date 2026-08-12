import { deepFreeze } from "@news-podcast/kernel"
import { Schema } from "effect"

import {
  AudioObjectKeySchema,
  EpisodeIdSchema,
  HttpUrlSchema,
  OwnerIdSchema,
  UtcInstantSchema,
  type CompletedEpisode,
} from "./episode.js"

export const InboxMessageIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("InboxMessageId")
)
export type InboxMessageId = Schema.Schema.Type<typeof InboxMessageIdSchema>

export const CompletionSourceSchema = Schema.Struct({
  url: HttpUrlSchema,
  title: Schema.NonEmptyString,
})
export type CompletionSource = Schema.Schema.Type<typeof CompletionSourceSchema>

export const EpisodeCompletionNoticeSchema = Schema.Struct({
  messageId: InboxMessageIdSchema,
  episodeId: EpisodeIdSchema,
  ownerId: OwnerIdSchema,
  audioObjectKey: AudioObjectKeySchema,
  title: Schema.NonEmptyString,
  sources: Schema.NonEmptyArray(CompletionSourceSchema),
  occurredAt: UtcInstantSchema,
})
export type EpisodeCompletionNotice = Schema.Schema.Type<
  typeof EpisodeCompletionNoticeSchema
>

export const matchesCompletionNotice = (
  episode: CompletedEpisode,
  notice: EpisodeCompletionNotice
): boolean =>
  episode.id === notice.episodeId &&
  episode.ownerId === notice.ownerId &&
  episode.audio.objectKey === notice.audioObjectKey &&
  episode.title === notice.title &&
  episode.createdAt === notice.occurredAt &&
  episode.sources.length === notice.sources.length &&
  episode.sources.every(
    (source, index) =>
      source.url === notice.sources[index]?.url &&
      source.title === notice.sources[index]?.title
  )

export const completionContractMismatch = () =>
  deepFreeze({ _tag: "EpisodeCompletionContractMismatch" as const })
