import { Schema } from "effect"

import { TagNameSchema } from "../../../../domain/content-taxonomy.js"

const uniqueNames = Schema.makeFilter<readonly string[]>((names) =>
  new Set(names).size === names.length ? true : "tag names must be unique"
)

export const EnrichmentPayloadSchema = Schema.Struct({
  summary: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
    Schema.isMaxLength(2_000)
  ),
  score: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(100)
  ),
  reason: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
    Schema.isMaxLength(1_000)
  ),
  tags: Schema.Array(TagNameSchema).check(Schema.isMaxLength(20), uniqueNames),
  suggestedTags: Schema.Array(TagNameSchema).check(
    Schema.isMaxLength(20),
    uniqueNames
  ),
})
