import { deepFreeze } from "@news-podcast/kernel"
import { Schema } from "effect"

import {
  EpisodeIdSchema,
  EpisodeScriptSchema,
  EpisodeTitleSchema,
  OwnerIdSchema,
  RssSourceSchema,
  StoredAudioSchema,
  UtcInstantSchema,
  type CompletedEpisode,
} from "./episode.js"

export const InboxMessageIdSchema = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("InboxMessageId")
)
export type InboxMessageId = Schema.Schema.Type<typeof InboxMessageIdSchema>

export const EpisodeCompletionNoticeSchema = Schema.Struct({
  messageId: InboxMessageIdSchema,
  episodeId: EpisodeIdSchema,
  ownerId: OwnerIdSchema,
  title: EpisodeTitleSchema,
  script: EpisodeScriptSchema,
  audio: StoredAudioSchema,
  sources: Schema.NonEmptyArray(RssSourceSchema),
  completedAt: UtcInstantSchema,
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
  episode.script === notice.script &&
  episode.audio.objectKey === notice.audio.objectKey &&
  episode.audio.byteLength === notice.audio.byteLength &&
  episode.audio.contentType === notice.audio.contentType &&
  episode.title === notice.title &&
  episode.createdAt === notice.completedAt &&
  episode.sources.length === notice.sources.length &&
  episode.sources.every(
    (source, index) =>
      source.url === notice.sources[index]?.url &&
      source.title === notice.sources[index]?.title &&
      source._tag === "RssSource" &&
      source.articleId === notice.sources[index]?.articleId &&
      source.snapshotId === notice.sources[index]?.snapshotId &&
      source.publishedAt === notice.sources[index]?.publishedAt
  )

export const completionContractMismatch = () =>
  deepFreeze({ _tag: "EpisodeCompletionContractMismatch" as const })
