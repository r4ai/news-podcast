import { Schema } from "effect"

import {
  ArticleIdSchema,
  JobIdSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
} from "./episode-job.js"

export const GenerationPlanSchema = Schema.Struct({
  jobId: JobIdSchema,
  ownerId: OwnerIdSchema,
  selectionMode: Schema.Literals(["automatic", "manual"]),
  interestProfile: Schema.Struct({
    include: Schema.String.check(Schema.isMaxLength(2_000)),
    exclude: Schema.String.check(Schema.isMaxLength(2_000)),
  }),
  selectedArticleIds: Schema.NonEmptyArray(ArticleIdSchema).check(
    Schema.isMaxLength(20),
    Schema.makeFilter((ids: readonly string[]) =>
      new Set(ids).size === ids.length ? true : "article IDs must be unique"
    )
  ),
  model: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  createdAt: UtcTimestampSchema,
})

type DecodedGenerationPlan = Schema.Schema.Type<typeof GenerationPlanSchema>
export type GenerationPlan = Omit<
  DecodedGenerationPlan,
  "selectedArticleIds"
> & {
  readonly selectedArticleIds: readonly Schema.Schema.Type<
    typeof ArticleIdSchema
  >[]
}
