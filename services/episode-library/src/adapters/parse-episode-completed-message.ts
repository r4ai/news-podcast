import {
  parseEpisodeCompleted,
  parseMessageEnvelope,
} from "@news-podcast/protocols"
import { DateTime, Effect } from "effect"

import {
  EpisodeCompletionNoticeSchema,
  type EpisodeCompletionNotice,
} from "../domain/episode-completion.js"
import { parse } from "@news-podcast/kernel"

const parseNotice = parse(EpisodeCompletionNoticeSchema)

const untrustedProducer = () =>
  Effect.fail({ _tag: "UntrustedEpisodeCompletionProducer" as const })

/** Parses both the generic envelope and its versioned EpisodeCompleted payload. */
export const parseEpisodeCompletedMessage = (input: unknown) =>
  Effect.gen(function* () {
    const envelope = yield* parseMessageEnvelope(input)
    if (
      envelope.producer !== "episode-production" ||
      envelope.actor._tag !== "Service" ||
      envelope.actor.service !== "episode-production"
    ) {
      return yield* untrustedProducer()
    }
    const payload = yield* parseEpisodeCompleted(envelope.payload)
    return (yield* parseNotice({
      messageId: envelope.messageId,
      episodeId: payload.episodeId,
      ownerId: payload.ownerId,
      audioObjectKey: payload.audioObjectKey,
      title: payload.title,
      sources: payload.sources,
      occurredAt: DateTime.formatIso(envelope.occurredAt),
    })) as EpisodeCompletionNotice
  })
