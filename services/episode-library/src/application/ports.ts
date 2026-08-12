import type { Effect } from "effect"

import type {
  AudioObjectKey,
  CompletedEpisode,
  EpisodeId,
  HttpUrl,
  OwnerId,
  UtcInstant,
} from "../domain/episode.js"

export type EpisodeLibraryStorageFailure = Readonly<{
  _tag: "EpisodeLibraryStorageFailure"
  operation: "list" | "find"
}>

export type EpisodePagePosition = Readonly<{
  createdAt: UtcInstant
  episodeId: EpisodeId
}>

export type EpisodePageQuery = Readonly<{
  after?: EpisodePagePosition
  limit: number
}>

export interface CompletedEpisodeReader {
  listPageByOwner(
    ownerId: OwnerId,
    query: EpisodePageQuery
  ): Effect.Effect<readonly CompletedEpisode[], EpisodeLibraryStorageFailure>
  findByOwner(
    ownerId: OwnerId,
    episodeId: EpisodeId
  ): Effect.Effect<CompletedEpisode | undefined, EpisodeLibraryStorageFailure>
}

export type AudioAccessSigningFailure = Readonly<{
  _tag: "AudioAccessSigningFailure"
}>

export interface AudioAccessSigner {
  issue(input: {
    readonly objectKey: AudioObjectKey
    readonly contentType: "audio/wav" | "audio/mpeg"
    readonly expiresAtEpochMillis: number
  }): Effect.Effect<HttpUrl, AudioAccessSigningFailure>
}
