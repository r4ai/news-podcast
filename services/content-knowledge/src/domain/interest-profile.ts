import { deepFreeze, parse } from "@news-podcast/kernel"
import { Schema } from "effect"

export const InterestProfileSchema = Schema.Struct({
  include: Schema.String.check(Schema.isMaxLength(2_000)),
  exclude: Schema.String.check(Schema.isMaxLength(2_000)),
})
export type InterestProfile = Schema.Schema.Type<typeof InterestProfileSchema>
export const parseInterestProfile = parse(InterestProfileSchema)

export const defaultInterestProfile: InterestProfile = deepFreeze({
  include: "",
  exclude: "",
})
