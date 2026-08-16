import { Schema } from "effect"

export const ArticleSelectionPayloadSchema = Schema.Struct({
  selectedArticleIds: Schema.NonEmptyArray(Schema.String).check(
    Schema.isMaxLength(20)
  ),
})
