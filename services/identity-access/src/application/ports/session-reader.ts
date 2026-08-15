import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import type { Effect, Option } from "effect"

import type { AuthenticatedActor } from "../../domain/actor.js"

export type SessionLookupRequest = {
  readonly headers: ReadonlyArray<{
    readonly name: string
    readonly value: string
  }>
}

export type SessionProviderUnavailable = DeepReadonly<{
  _tag: "SessionProviderUnavailable"
  message: string
}>

export type MalformedSessionResponse = DeepReadonly<{
  _tag: "MalformedSessionResponse"
}>

export type SessionLookupError =
  | SessionProviderUnavailable
  | MalformedSessionResponse

export type SessionReader = Readonly<{
  findAuthenticatedActor: (
    request: SessionLookupRequest
  ) => Effect.Effect<Option.Option<AuthenticatedActor>, SessionLookupError>
}>

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Better Auth request failed"

export const sessionProviderUnavailable = (
  cause: unknown
): SessionProviderUnavailable =>
  deepFreeze({
    _tag: "SessionProviderUnavailable",
    message: errorMessage(cause),
  })

export const malformedSessionResponse = (): MalformedSessionResponse =>
  deepFreeze({ _tag: "MalformedSessionResponse" })
