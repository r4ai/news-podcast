import { deepFreeze } from "@news-podcast/kernel"
import { Effect, Option } from "effect"

import { anonymousActor, type Actor } from "../domain/actor.js"
import type {
  SessionLookupError,
  SessionLookupRequest,
  SessionReader,
} from "./ports/session-reader.js"

export const resolveSession = (reader: SessionReader) =>
  function resolve(
    request: SessionLookupRequest
  ): Effect.Effect<Actor, SessionLookupError> {
    return reader.findAuthenticatedActor(request).pipe(
      Effect.map(
        Option.match({
          onNone: () => anonymousActor,
          onSome: (actor) => actor,
        })
      ),
      Effect.map(deepFreeze)
    )
  }
