import type { Effect } from "effect"

import type {
  EpisodeCompletionNotice,
  InboxMessageId,
} from "../../domain/episode-completion.js"
import type { CompletedEpisode, UtcInstant } from "../../domain/episode.js"

export type CompletionMaterializationFailure = Readonly<{
  _tag: "CompletionMaterializationFailure"
}>

export type CompletionStoreFailure = Readonly<{
  _tag: "CompletionStoreFailure"
  operation: "save"
}>

export type CompletionSaveResult = "Stored" | "Duplicate"

export interface EpisodeCompletionPorts {
  materialize(
    notice: EpisodeCompletionNotice
  ): Effect.Effect<CompletedEpisode, CompletionMaterializationFailure>
  /** Inbox insertion and aggregate persistence are one transaction. */
  saveOnce(
    messageId: InboxMessageId,
    episode: CompletedEpisode,
    receivedAt: UtcInstant
  ): Effect.Effect<CompletionSaveResult, CompletionStoreFailure>
}
