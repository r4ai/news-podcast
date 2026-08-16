import { Schema } from "effect"

export const MAXIMUM_TITLE_CHARACTERS = 200
export const MAXIMUM_SCRIPT_CHARACTERS = 6_000
export const MAXIMUM_SOURCE_COUNT = 20
export const MAXIMUM_SOURCE_MARKDOWN_CHARACTERS = 6_000

export const ScriptPayloadSchema = Schema.Struct({
  title: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAXIMUM_TITLE_CHARACTERS)
  ),
  script: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAXIMUM_SCRIPT_CHARACTERS)
  ),
  source_ids: Schema.NonEmptyArray(
    Schema.String.check(Schema.isPattern(/^source-[1-9][0-9]*$/))
  ).check(Schema.isMaxLength(MAXIMUM_SOURCE_COUNT)),
})
