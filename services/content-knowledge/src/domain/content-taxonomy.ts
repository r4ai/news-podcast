import { Schema } from "effect"

import { ArticleIdSchema } from "./article.js"
import { CapturedAtSchema } from "./article.js"

const uuid = <Brand extends string>(brand: Brand) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(brand))

export const TagIdSchema = uuid("TagId")
export type TagId = Schema.Schema.Type<typeof TagIdSchema>

export const TagNameSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(50),
  Schema.makeFilter((name: string) =>
    [...name].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 31 && codePoint !== 127
    })
      ? true
      : "tag name must not contain control characters"
  )
).pipe(Schema.brand("TagName"))
export type TagName = Schema.Schema.Type<typeof TagNameSchema>

export const TagSchema = Schema.Struct({
  tagId: TagIdSchema,
  name: TagNameSchema,
  createdAt: CapturedAtSchema,
})
export type Tag = Schema.Schema.Type<typeof TagSchema>

export const TagSuggestionSchema = Schema.Struct({
  name: TagNameSchema,
  occurrences: Schema.Int.check(Schema.isGreaterThan(0)),
  lastSeenAt: CapturedAtSchema,
})
export type TagSuggestion = Schema.Schema.Type<typeof TagSuggestionSchema>

export const ArticleTagSourceSchema = Schema.Literals(["Manual", "Ai"])
export type ArticleTagSource = Schema.Schema.Type<typeof ArticleTagSourceSchema>

export const ArticleTagSchema = Schema.Struct({
  articleId: ArticleIdSchema,
  tagId: TagIdSchema,
  name: TagNameSchema,
  source: ArticleTagSourceSchema,
  confidence: Schema.NullOr(
    Schema.Number.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(1)
    )
  ),
})
export type ArticleTag = Schema.Schema.Type<typeof ArticleTagSchema>
