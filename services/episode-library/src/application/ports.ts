import type { Effect } from "effect"

import type {
  AudioObjectKey,
  CompletedEpisode,
  EpisodeId,
  HttpUrl,
  OwnerId,
} from "../domain/episode.js"

export type EpisodeLibraryStorageFailure = Readonly<{
  _tag: "EpisodeLibraryStorageFailure"
  operation: "list" | "find"
}>

export interface CompletedEpisodeReader {
  listByOwner(
    ownerId: OwnerId
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
