import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

import { EpisodeIdSchema, OwnerIdSchema } from "../domain/episode.js"

const ListCompletedEpisodesInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
})

const OwnedEpisodeInputSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  episodeId: EpisodeIdSchema,
})

export const parseListCompletedEpisodesInput = parse(
  ListCompletedEpisodesInputSchema
)
export const parseGetCompletedEpisodeInput = parse(OwnedEpisodeInputSchema)
export const parseIssueAudioAccessInput = parse(OwnedEpisodeInputSchema)
