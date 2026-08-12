import { deepFreeze } from "@news-podcast/kernel"
import { Effect, Option, Schema } from "effect"

import {
  malformedSessionResponse,
  sessionProviderUnavailable,
  type SessionReader,
} from "../application/session-reader.js"
import { authenticatedActor, UserIdSchema } from "../domain/actor.js"

const BetterAuthSessionSchema = Schema.NullOr(
  Schema.Struct({
    user: Schema.Struct({ id: UserIdSchema }),
  })
)
const decodeBetterAuthSession = Schema.decodeUnknownEffect(
  BetterAuthSessionSchema,
  { errors: "all", onExcessProperty: "ignore" }
)
const parseBetterAuthSession = (input: unknown) =>
  decodeBetterAuthSession(input).pipe(Effect.map(deepFreeze))

export type BetterAuthSessionApi = Readonly<{
  getSession: (input: { readonly headers: Headers }) => PromiseLike<unknown>
}>

export const makeBetterAuthSessionReader = (
  api: BetterAuthSessionApi
): SessionReader =>
  deepFreeze({
    findAuthenticatedActor: (request) =>
      Effect.tryPromise({
        try: () =>
          api.getSession({
            headers: new Headers(
              request.headers.map(({ name, value }): [string, string] => [
                name,
                value,
              ])
            ),
          }),
        catch: sessionProviderUnavailable,
      }).pipe(
        Effect.flatMap((external) =>
          parseBetterAuthSession(external).pipe(
            Effect.mapError(malformedSessionResponse)
          )
        ),
        Effect.map((session) =>
          deepFreeze(
            Option.fromNullOr(session).pipe(
              Option.map(({ user }) => authenticatedActor(user.id))
            )
          )
        )
      ),
  })
