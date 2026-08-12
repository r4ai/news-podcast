import { parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import { resolveSession } from "../application/resolve-session.js"
import type { SessionReader } from "../application/session-reader.js"

const HeaderSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  value: Schema.String,
})
export const SessionLookupRequestSchema = Schema.Struct({
  headers: Schema.Array(HeaderSchema),
})
export const parseSessionLookupRequest = parse(SessionLookupRequestSchema)

export const makeResolveSessionHandler = (reader: SessionReader) => {
  const resolve = resolveSession(reader)
  return (input: unknown) =>
    parseSessionLookupRequest(input).pipe(Effect.flatMap(resolve))
}
