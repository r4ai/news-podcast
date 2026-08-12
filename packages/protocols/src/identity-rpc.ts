import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

import { ResolveSessionResponseSchema } from "./contracts.js"

const SessionHeaderSchema = Schema.Struct({
  name: Schema.NonEmptyString.check(
    Schema.isMaxLength(256),
    Schema.isPattern(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  ),
  value: Schema.String.check(Schema.isMaxLength(8_192)),
})

export const ResolveSessionRequestSchema = Schema.Struct({
  headers: Schema.Array(SessionHeaderSchema).check(Schema.isMaxLength(100)),
})
export type ResolveSessionRequest = Schema.Schema.Type<
  typeof ResolveSessionRequestSchema
>
export const parseResolveSessionRequest = parse(ResolveSessionRequestSchema)

export const ResolveSessionRejectionSchema = Schema.TaggedStruct("Rejected", {
  code: Schema.Literals(["INVALID_REQUEST", "SESSION_PROVIDER_FAILURE"]),
})
export type ResolveSessionRejection = Schema.Schema.Type<
  typeof ResolveSessionRejectionSchema
>

export const ResolveSessionReplySchema = Schema.Union([
  ResolveSessionResponseSchema,
  ResolveSessionRejectionSchema,
])
export type ResolveSessionReply = Schema.Schema.Type<
  typeof ResolveSessionReplySchema
>
export const parseResolveSessionReply = parse(ResolveSessionReplySchema)
