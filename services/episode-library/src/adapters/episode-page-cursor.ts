import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import type { EpisodePagePosition } from "../application/ports/episode-library.js"
import { EpisodeIdSchema, UtcInstantSchema } from "../domain/episode.js"

const CursorPayloadSchema = Schema.Struct({
  v: Schema.Literal(1),
  createdAt: UtcInstantSchema,
  episodeId: EpisodeIdSchema,
})

const parseCursorPayload = parse(CursorPayloadSchema)
const cursorPattern = /^[A-Za-z0-9_-]+$/

export const encodeEpisodePageCursor = (
  position: EpisodePagePosition
): string =>
  Buffer.from(
    JSON.stringify({
      v: 1,
      createdAt: position.createdAt,
      episodeId: position.episodeId,
    }),
    "utf8"
  ).toString("base64url")

export const decodeEpisodePageCursor = (
  cursor: string
): Effect.Effect<EpisodePagePosition, unknown> =>
  Effect.gen(function* () {
    if (
      cursor.length === 0 ||
      cursor.length > 512 ||
      !cursorPattern.test(cursor)
    ) {
      return yield* Effect.fail(new Error("Invalid episode page cursor"))
    }
    const json = yield* Effect.try({
      try: () => Buffer.from(cursor, "base64url").toString("utf8"),
      catch: () => new Error("Invalid episode page cursor"),
    })
    const payload = yield* Effect.try({
      try: (): unknown => JSON.parse(json),
      catch: () => new Error("Invalid episode page cursor"),
    }).pipe(Effect.flatMap(parseCursorPayload))
    if (encodeEpisodePageCursor(payload) !== cursor) {
      return yield* Effect.fail(new Error("Non-canonical episode page cursor"))
    }
    return deepFreeze({
      createdAt: payload.createdAt,
      episodeId: payload.episodeId,
    })
  })
