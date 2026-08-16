import { Schema } from "effect"

export const MAXIMUM_TERMS = 30
export const MAXIMUM_SCRIPT_CHARACTERS = 6_000

export const ReadingTermsPayloadSchema = Schema.Struct({
  terms: Schema.Array(
    Schema.Struct({
      surface: Schema.String,
      reading: Schema.String,
      accent_type: Schema.Int,
    })
  ).check(Schema.isMaxLength(MAXIMUM_TERMS)),
})
