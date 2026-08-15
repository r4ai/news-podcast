import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import {
  toPublicEpisode,
  type EpisodeId,
  type HttpUrl,
  type OwnerId,
  type UtcInstant,
} from "../domain/episode.js"
import type {
  AudioAccessSigner,
  CompletedEpisodeReader,
} from "./ports/episode-library.js"
import type { EpisodePagePosition } from "./ports/episode-library.js"

const AUDIO_ACCESS_TTL_MILLIS = 5 * 60_000
export const COMPLETED_EPISODE_PAGE_SIZE = 20

export type EpisodeNotFound = Readonly<{ _tag: "EpisodeNotFound" }>

export type AudioAccess = Readonly<{
  url: HttpUrl
  expiresAt: UtcInstant
}>

type OwnedEpisodeInput = Readonly<{
  ownerId: OwnerId
  episodeId: EpisodeId
}>

export const listCompletedEpisodes = (reader: CompletedEpisodeReader) =>
  Effect.fn("episodeLibrary.list")(function* (input: {
    readonly ownerId: OwnerId
    readonly after?: EpisodePagePosition
  }) {
    const episodes = yield* reader.listPageByOwner(input.ownerId, {
      ...(input.after === undefined ? {} : { after: input.after }),
      limit: COMPLETED_EPISODE_PAGE_SIZE + 1,
    })
    const owned = episodes.filter(
      (episode) => episode.ownerId === input.ownerId
    )
    const hasMore = owned.length > COMPLETED_EPISODE_PAGE_SIZE
    const visible = owned.slice(0, COMPLETED_EPISODE_PAGE_SIZE)
    const last = visible.at(-1)
    return deepFreeze({
      items: visible.map(toPublicEpisode),
      hasMore,
      ...(hasMore && last !== undefined
        ? { next: { createdAt: last.createdAt, episodeId: last.id } }
        : {}),
    })
  })

export const getCompletedEpisode = (reader: CompletedEpisodeReader) =>
  Effect.fn("episodeLibrary.get")(function* (input: OwnedEpisodeInput) {
    const episode = yield* reader.findByOwner(input.ownerId, input.episodeId)
    if (episode === undefined || episode.ownerId !== input.ownerId) {
      return yield* Effect.fail<EpisodeNotFound>(
        deepFreeze({ _tag: "EpisodeNotFound" })
      )
    }
    return toPublicEpisode(episode)
  })

export const issueAudioAccess = (
  reader: CompletedEpisodeReader,
  signer: AudioAccessSigner,
  nowEpochMillis: () => number
) =>
  Effect.fn("episodeLibrary.issueAudioAccess")(function* (
    input: OwnedEpisodeInput
  ) {
    const episode = yield* reader.findByOwner(input.ownerId, input.episodeId)
    if (episode === undefined || episode.ownerId !== input.ownerId) {
      return yield* Effect.fail<EpisodeNotFound>(
        deepFreeze({ _tag: "EpisodeNotFound" })
      )
    }

    const expiresAtEpochMillis = nowEpochMillis() + AUDIO_ACCESS_TTL_MILLIS
    const url = yield* signer.issue({
      objectKey: episode.audio.objectKey,
      contentType: episode.audio.contentType,
      expiresAtEpochMillis,
    })
    return deepFreeze({
      url,
      expiresAt: new Date(expiresAtEpochMillis).toISOString() as UtcInstant,
    })
  })
