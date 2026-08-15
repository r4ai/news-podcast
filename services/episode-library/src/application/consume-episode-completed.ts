import { Effect } from "effect"

import {
  completionContractMismatch,
  matchesCompletionNotice,
  type EpisodeCompletionNotice,
} from "../domain/episode-completion.js"
import type { EpisodeCompletionPorts } from "./ports/completion.js"

export const consumeEpisodeCompleted = (ports: EpisodeCompletionPorts) =>
  Effect.fn("episodeLibrary.consumeEpisodeCompleted")(function* (
    notice: EpisodeCompletionNotice
  ) {
    const episode = yield* ports.materialize(notice)
    if (!matchesCompletionNotice(episode, notice)) {
      return yield* Effect.fail(completionContractMismatch())
    }
    return yield* ports.saveOnce(notice.messageId, episode, notice.occurredAt)
  })
