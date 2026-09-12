import { parse } from "@news-podcast/kernel"
import { Schema } from "effect"

import { IanaTimeZoneSchema } from "./generation-settings.js"

export const LocalDateSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter<string>((date) => {
    const instant = Date.parse(`${date}T00:00:00.000Z`)
    return Number.isFinite(instant) &&
      new Date(instant).toISOString().slice(0, 10) === date
      ? undefined
      : "Expected a real canonical local date"
  })
)
export const UtcInstantSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter<string>((instant) => {
    const timestamp = Date.parse(instant)
    return Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString() === instant
      ? undefined
      : "Expected a real canonical UTC instant"
  })
)
export const RecordedScheduleCompletionSchema = Schema.Struct({
  source: Schema.Literal("recorded"),
  localDate: LocalDateSchema,
  recordedAt: UtcInstantSchema,
  timeZone: IanaTimeZoneSchema,
})
export const ScheduleCompletionSchema = Schema.Union([
  RecordedScheduleCompletionSchema,
  Schema.Struct({
    source: Schema.Literal("legacy"),
    localDate: LocalDateSchema,
  }),
])
export type ScheduleCompletion = Schema.Schema.Type<
  typeof ScheduleCompletionSchema
>
export const parseScheduleCompletion = parse(ScheduleCompletionSchema)
export const parseLocalDate = parse(LocalDateSchema)

/** Gregorian day ordinal, independent of elapsed 23/24/25-hour DST days. Input is validated at the boundary. */
export const localDateOrdinal = (date: string): number =>
  Date.parse(`${date}T00:00:00.000Z`) / 86_400_000
export type ScheduleSuppression = "past_local_day" | "stale_completion"
