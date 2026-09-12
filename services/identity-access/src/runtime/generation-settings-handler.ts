import { parse } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  completeScheduledGeneration,
  findDueGenerationSchedules,
  getGenerationSettings,
  updateGenerationSettings,
  type GenerationSettingsRepository,
} from "../application/generation-settings.js"
import {
  UtcInstantSchema,
  LocalDateSchema,
  type ScheduleSuppression,
} from "../domain/schedule-completion.js"
import { UserIdSchema } from "../domain/actor.js"
import { GenerationScheduleSchema } from "../domain/generation-settings.js"

export const GetGenerationSettingsRequestSchema = Schema.Struct({
  ownerId: UserIdSchema,
})
export const UpdateGenerationSettingsRequestSchema = Schema.Struct({
  ownerId: UserIdSchema,
  generationSchedule: GenerationScheduleSchema,
})
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
  repository: GenerationSettingsRepository,
  observeSuppression?: (reason: ScheduleSuppression) => void
) => {
  const findDue = findDueGenerationSchedules(repository, observeSuppression)
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
