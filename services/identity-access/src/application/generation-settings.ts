import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Option } from "effect"

import type { UserId } from "../domain/actor.js"
import {
  defaultGenerationSchedule,
  type GenerationSchedule,
} from "../domain/generation-settings.js"

export type GenerationSettingsStoreError = DeepReadonly<{
  readonly _tag: "GenerationSettingsStoreFailed"
  readonly operation: "Find" | "Save" | "ListEnabled" | "MarkScheduled"
  readonly reason: "CorruptRecord" | "Unavailable"
}>

export type ScheduledOwner = DeepReadonly<{
  readonly ownerId: UserId
  readonly schedule: GenerationSchedule
  readonly lastScheduledLocalDate?: string
}>

export type DueGenerationSchedule = DeepReadonly<{
  readonly ownerId: UserId
  readonly localDate: string
}>

export type GenerationSettingsRepository = DeepReadonly<{
  readonly find: (
    ownerId: UserId
  ) => Effect.Effect<
    Option.Option<GenerationSchedule>,
    GenerationSettingsStoreError
  >
  readonly save: (
    ownerId: UserId,
    schedule: GenerationSchedule
  ) => Effect.Effect<GenerationSchedule, GenerationSettingsStoreError>
  readonly listEnabled: () => Effect.Effect<
    readonly ScheduledOwner[],
    GenerationSettingsStoreError
  >
  readonly markScheduled: (
    ownerId: UserId,
    localDate: string
  ) => Effect.Effect<void, GenerationSettingsStoreError>
}>

export const getGenerationSettings =
  (repository: GenerationSettingsRepository) =>
  (
    ownerId: UserId
  ): Effect.Effect<GenerationSchedule, GenerationSettingsStoreError> =>
    repository.find(ownerId).pipe(
      Effect.map(
        Option.match({
          onNone: () => defaultGenerationSchedule,
          onSome: (schedule) => schedule,
        })
      ),
      Effect.map(deepFreeze),
      Effect.withSpan("identityAccess.getGenerationSettings")
    )

export const updateGenerationSettings =
  (repository: GenerationSettingsRepository) =>
  (input: {
    readonly ownerId: UserId
    readonly schedule: GenerationSchedule
  }): Effect.Effect<GenerationSchedule, GenerationSettingsStoreError> =>
    repository
      .save(input.ownerId, input.schedule)
      .pipe(
        Effect.map(deepFreeze),
        Effect.withSpan("identityAccess.updateGenerationSettings")
      )

const localClock = (instant: string, schedule: GenerationSchedule) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: schedule.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant))
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  )
  return deepFreeze({
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  })
}

/** Read-only due discovery. Production creates an idempotent job before completion is recorded. */
export const findDueGenerationSchedules =
  (repository: GenerationSettingsRepository) =>
  (
    instant: string
  ): Effect.Effect<
    readonly DueGenerationSchedule[],
    GenerationSettingsStoreError
  > =>
    repository.listEnabled().pipe(
      Effect.map((owners) =>
        owners.flatMap((owner) => {
          const local = localClock(instant, owner.schedule)
          return local.time < owner.schedule.localTime ||
            local.date === owner.lastScheduledLocalDate
            ? []
            : [deepFreeze({ ownerId: owner.ownerId, localDate: local.date })]
        })
      ),
      Effect.map(deepFreeze),
      Effect.withSpan("identityAccess.findDueGenerationSchedules")
    )

export const completeScheduledGeneration =
  (repository: GenerationSettingsRepository) =>
  (
    due: DueGenerationSchedule
  ): Effect.Effect<void, GenerationSettingsStoreError> =>
    repository
      .markScheduled(due.ownerId, due.localDate)
      .pipe(Effect.withSpan("identityAccess.completeScheduledGeneration"))
