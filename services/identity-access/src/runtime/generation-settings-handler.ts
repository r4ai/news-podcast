import { parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  completeScheduledGeneration,
  findDueGenerationSchedules,
  getGenerationSettings,
  updateGenerationSettings,
  type GenerationSettingsRepository,
} from "../application/generation-settings.js"
import { UserIdSchema } from "../domain/actor.js"
import { GenerationScheduleSchema } from "../domain/generation-settings.js"

export const GetGenerationSettingsRequestSchema = Schema.Struct({
  ownerId: UserIdSchema,
})
export const UpdateGenerationSettingsRequestSchema = Schema.Struct({
  ownerId: UserIdSchema,
  generationSchedule: GenerationScheduleSchema,
})
const UtcInstantSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter<string>((instant) => {
    const timestamp = Date.parse(instant)
    return Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString() === instant
      ? undefined
      : "Expected a real canonical UTC instant"
  })
)
const LocalDateSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter<string>((localDate) => {
    const [year, month, day] = localDate.split("-").map(Number)
    if (year === undefined || month === undefined || day === undefined)
      return "Expected a real local date"
    const candidate = new Date(Date.UTC(year, month - 1, day))
    return candidate.toISOString().slice(0, 10) === localDate
      ? undefined
      : "Expected a real local date"
  })
)
export const FindDueGenerationSchedulesRequestSchema = Schema.Struct({
  instant: UtcInstantSchema,
})
export const CompleteScheduledGenerationRequestSchema = Schema.Struct({
  ownerId: UserIdSchema,
  localDate: LocalDateSchema,
})
export const parseGetGenerationSettingsRequest = parse(
  GetGenerationSettingsRequestSchema
)
export const parseUpdateGenerationSettingsRequest = parse(
  UpdateGenerationSettingsRequestSchema
)
export const parseFindDueGenerationSchedulesRequest = parse(
  FindDueGenerationSchedulesRequestSchema
)
export const parseCompleteScheduledGenerationRequest = parse(
  CompleteScheduledGenerationRequestSchema
)

export const makeGetGenerationSettingsHandler = (
  repository: GenerationSettingsRepository
) => {
  const get = getGenerationSettings(repository)
  return (input: unknown) =>
    parseGetGenerationSettingsRequest(input).pipe(
      Effect.flatMap(({ ownerId }) => get(ownerId)),
      Effect.withSpan("identityAccess.handleGetGenerationSettings")
    )
}

export const makeUpdateGenerationSettingsHandler = (
  repository: GenerationSettingsRepository
) => {
  const update = updateGenerationSettings(repository)
  return (input: unknown) =>
    parseUpdateGenerationSettingsRequest(input).pipe(
      Effect.flatMap(({ ownerId, generationSchedule }) =>
        update({ ownerId, schedule: generationSchedule })
      ),
      Effect.withSpan("identityAccess.handleUpdateGenerationSettings")
    )
}

export const makeFindDueGenerationSchedulesHandler = (
  repository: GenerationSettingsRepository
) => {
  const findDue = findDueGenerationSchedules(repository)
  return (input: unknown) =>
    parseFindDueGenerationSchedulesRequest(input).pipe(
      Effect.flatMap(({ instant }) => findDue(instant)),
      Effect.withSpan("identityAccess.handleFindDueGenerationSchedules")
    )
}

export const makeCompleteScheduledGenerationHandler = (
  repository: GenerationSettingsRepository
) => {
  const complete = completeScheduledGeneration(repository)
  return (input: unknown) =>
    parseCompleteScheduledGenerationRequest(input).pipe(
      Effect.flatMap(complete),
      Effect.withSpan("identityAccess.handleCompleteScheduledGeneration")
    )
}
