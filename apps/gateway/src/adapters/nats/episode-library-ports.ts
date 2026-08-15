import { parse } from "@news-podcast/kernel"
import {
  type CreateAudioAccessReply,
  parseCreateAudioAccessReply,
  parseGetEpisodeReply,
  parseListEpisodesReply,
  subjects,
} from "@news-podcast/protocols"
import { Effect, Schema } from "effect"

import {
  AudioAccessSchema,
  EpisodePageSchema,
  EpisodeSchema,
} from "../../contract.js"
import type { GatewayPorts } from "../../ports.js"
import { notFound, unavailable } from "./problems.js"
import type { Transport } from "./transport.js"

/**
 * 公開済みエピソードの参照と、音声への一時アクセス発行。
 */

type ParsedGetEpisodeReply = Effect.Success<
  ReturnType<typeof parseGetEpisodeReply>
>
type AudioAccess = Schema.Schema.Type<typeof AudioAccessSchema>
type AudioAccessFailure =
  | ReturnType<typeof notFound>
  | ReturnType<typeof unavailable>

const toEpisode = (
  reply: ParsedGetEpisodeReply
): Effect.Effect<
  Schema.Schema.Type<typeof EpisodeSchema>,
  ReturnType<typeof unavailable> | ReturnType<typeof notFound>
> => {
  if (reply._tag === "Found")
    return parse(EpisodeSchema)(reply.episode).pipe(
      Effect.mapError(unavailable)
    )
  if (reply._tag === "NotFound") return Effect.fail(notFound())
  return Effect.fail(unavailable())
}

const toAudioAccess = (
  reply: CreateAudioAccessReply
): Effect.Effect<AudioAccess, AudioAccessFailure> => {
  switch (reply._tag) {
    case "Found":
      return parse(AudioAccessSchema)(reply.access).pipe(
        Effect.mapError(unavailable)
      )
    case "NotFound":
      return Effect.fail(notFound())
    case "Rejected":
      return Effect.fail(unavailable())
  }
}

type EpisodeLibraryPorts = Pick<
  GatewayPorts,
  "listEpisodes" | "getEpisode" | "createAudioAccess"
>

export const makeEpisodeLibraryPorts = (
  transport: Transport
): EpisodeLibraryPorts => ({
  listEpisodes: ({ headers, cursor }) =>
    transport
      .ownerRpc(
        headers,
        subjects.library.listEpisodes,
        "episode-library",
        { ...(cursor === undefined ? {} : { cursor }) },
        parseListEpisodesReply
      )
      .pipe(
        Effect.flatMap((reply) =>
          reply._tag === "Listed"
            ? parse(EpisodePageSchema)(reply.page).pipe(
                Effect.mapError(unavailable)
              )
            : Effect.fail(unavailable())
        )
      ),
  getEpisode: ({ headers, episodeId }) =>
    transport
      .ownerRpc(
        headers,
        subjects.library.getEpisode,
        "episode-library",
        { episodeId },
        parseGetEpisodeReply
      )
      .pipe(Effect.flatMap(toEpisode)),
  createAudioAccess: ({ headers, episodeId }) =>
    transport
      .ownerRpc(
        headers,
        subjects.library.createAudioAccess,
        "episode-library",
        { episodeId },
        parseCreateAudioAccessReply
      )
      .pipe(Effect.flatMap(toAudioAccess)),
})
