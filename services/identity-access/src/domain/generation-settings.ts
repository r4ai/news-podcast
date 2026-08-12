import { deepFreeze, parse } from "@news-podcast/kernel"
import { Schema } from "effect"

const IanaTimeZoneSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.makeFilter<string>((timeZone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format()
      return undefined
    } catch {
      return "Expected an IANA time-zone identifier"
    }
  })
).pipe(Schema.brand("IanaTimeZone"))

export const LocalTimeSchema = Schema.String.check(
  Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
).pipe(Schema.brand("LocalTime"))

export const GenerationScheduleSchema = Schema.Struct({
  enabled: Schema.Boolean,
  localTime: LocalTimeSchema,
  timeZone: IanaTimeZoneSchema,
})
export type GenerationSchedule = Schema.Schema.Type<
  typeof GenerationScheduleSchema
>

export const parseGenerationSchedule = parse(GenerationScheduleSchema)

export const defaultGenerationSchedule: GenerationSchedule = deepFreeze({
  enabled: false,
  localTime: "07:30" as GenerationSchedule["localTime"],
  timeZone: "Asia/Tokyo" as GenerationSchedule["timeZone"],
})
