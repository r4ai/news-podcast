import {
  ResolveSessionRequestSchema,
  parseResolveSessionRequest,
} from "@news-podcast/protocols"
import { Effect } from "effect"

import { resolveSession } from "../application/resolve-session.js"
import type { SessionReader } from "../application/session-reader.js"

export const SessionLookupRequestSchema = ResolveSessionRequestSchema
export const parseSessionLookupRequest = parseResolveSessionRequest

export const makeResolveSessionHandler = (reader: SessionReader) => {
  const resolve = resolveSession(reader)
  return (input: unknown) =>
    parseSessionLookupRequest(input).pipe(Effect.flatMap(resolve))
}
