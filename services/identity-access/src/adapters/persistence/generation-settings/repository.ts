import { deepFreeze, parse } from "@news-podcast/kernel"
import { databaseSpanOptions } from "@news-podcast/persistence"
import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"

import { userSettings } from "../../../../drizzle/schema.js"
import type {
  GenerationSettingsRepository,
  GenerationSettingsStoreError,
  ScheduledOwner,
} from "../../../application/generation-settings.js"
import { UserIdSchema } from "../../../domain/actor.js"
import { GenerationScheduleSchema } from "../../../domain/generation-settings.js"
import {
  localDateOrdinal,
  parseLocalDate,
  parseScheduleCompletion,
  type ScheduleSuppression,
} from "../../../domain/schedule-completion.js"
import { currentScheduleInstantUnsafe } from "../../../infrastructure/unsafe/schedule-clock.js"
import type { IdentityDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"

const SettingsRowSchema = Schema.Struct({
  ownerId: Schema.String,
  enabled: Schema.Literals([0, 1]),
  localTime: Schema.String,
  timeZone: Schema.String,
  lastScheduledLocalDate: Schema.NullOr(Schema.String),
  lastScheduledDay: Schema.NullOr(Schema.Int),
  lastScheduledCompletion: Schema.NullOr(Schema.String),
})
const parseSettingsRow = parse(SettingsRowSchema)

const failure = (
  operation: GenerationSettingsStoreError["operation"],
  reason: GenerationSettingsStoreError["reason"] = "Unavailable"
): GenerationSettingsStoreError =>
  deepFreeze({ _tag: "GenerationSettingsStoreFailed", operation, reason })

const spanOptions = (operation: string) =>
  databaseSpanOptions("identity-access", operation)

const projection = {
  ownerId: userSettings.ownerId,
  enabled: userSettings.scheduleEnabled,
  localTime: userSettings.scheduleLocalTime,
  timeZone: userSettings.scheduleTimeZone,
  lastScheduledLocalDate: userSettings.lastScheduledLocalDate,
  lastScheduledDay: userSettings.lastScheduledDay,
  lastScheduledCompletion: userSettings.lastScheduledCompletion,
}

/**
 * 行の型はDrizzleが与えるが、ブランド型と時刻書式はドメインの不変条件であり
 * 列の型では代替できない。境界での再検証は維持する。
 */
const decodeRow = (
  row: unknown,
  operation: GenerationSettingsStoreError["operation"]
) =>
  parseSettingsRow(row).pipe(
    Effect.flatMap((value) =>
      Effect.gen(function* () {
        const ownerId = yield* parse(UserIdSchema)(value.ownerId)
        const schedule = yield* parse(GenerationScheduleSchema)({
          enabled: value.enabled === 1,
          localTime: value.localTime,
          timeZone: value.timeZone,
        })
        if (value.lastScheduledLocalDate === null) {
          if (
            value.lastScheduledDay !== null ||
            value.lastScheduledCompletion !== null
          )
            return yield* Effect.fail(failure(operation, "CorruptRecord"))
          return deepFreeze({ ownerId, schedule })
        }
        const lastCompletion = yield* (
          value.lastScheduledCompletion === null
            ? Effect.succeed({
                source: "legacy",
                localDate: value.lastScheduledLocalDate,
              })
            : Effect.try({
                try: (): unknown => JSON.parse(value.lastScheduledCompletion!),
                catch: () => failure(operation, "CorruptRecord"),
              })
        ).pipe(Effect.flatMap(parseScheduleCompletion))
        if (
          lastCompletion.localDate !== value.lastScheduledLocalDate ||
          localDateOrdinal(lastCompletion.localDate) !== value.lastScheduledDay
        )
          return yield* Effect.fail(failure(operation, "CorruptRecord"))
        return deepFreeze({
          ownerId,
          schedule,
          lastCompletion,
        }) satisfies ScheduledOwner
      })
    ),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const createGenerationSettingsRepository = (
  database: IdentityDatabase,
  options: {
    readonly now?: () => string
    readonly observeSuppression?: (reason: ScheduleSuppression) => void
  } = {}
): Effect.Effect<GenerationSettingsRepository, GenerationSettingsStoreError> =>
  Effect.sync(() => {
    const find: GenerationSettingsRepository["find"] = (ownerId) =>
      Effect.try({
        try: () =>
          database
            .select(projection)
            .from(userSettings)
            .where(eq(userSettings.ownerId, ownerId))
            .limit(1)
            .get(),
        catch: () => failure("Find"),
      }).pipe(
        Effect.flatMap((row) =>
          row === undefined
            ? Effect.succeed(Option.none())
            : decodeRow(row, "Find").pipe(
                Effect.map(({ schedule }) => Option.some(schedule))
              )
        ),
        Effect.withSpan("sqlite identity_settings find", spanOptions("SELECT"))
      )

    const save: GenerationSettingsRepository["save"] = (ownerId, schedule) =>
      Effect.try({
        try: () => {
          database
            .insert(userSettings)
            .values({
              ownerId,
              scheduleEnabled: schedule.enabled ? 1 : 0,
              scheduleLocalTime: schedule.localTime,
              scheduleTimeZone: schedule.timeZone,
            })
            .onConflictDoUpdate({
              target: userSettings.ownerId,
              set: {
                scheduleEnabled: schedule.enabled ? 1 : 0,
                scheduleLocalTime: schedule.localTime,
                scheduleTimeZone: schedule.timeZone,
              },
            })
            .run()
          return schedule
        },
        catch: () => failure("Save"),
      }).pipe(
        Effect.map(deepFreeze),
        Effect.withSpan("sqlite identity_settings save", spanOptions("UPSERT"))
      )

    const listEnabled: GenerationSettingsRepository["listEnabled"] = () =>
      Effect.try({
        try: () =>
          database
            .select(projection)
            .from(userSettings)
            .where(eq(userSettings.scheduleEnabled, 1))
            .all(),
        catch: () => failure("ListEnabled"),
      }).pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) => decodeRow(row, "ListEnabled"))
        ),
        Effect.map(deepFreeze),
        Effect.withSpan(
          "sqlite identity_settings list_enabled",
          spanOptions("SELECT")
        )
      )

    const markScheduled: GenerationSettingsRepository["markScheduled"] = (
      ownerId,
      localDate
    ) =>
      parseLocalDate(localDate).pipe(
        Effect.mapError(() => failure("MarkScheduled", "CorruptRecord")),
        Effect.flatMap((date) =>
          Effect.try({
            try: () => {
              const day = localDateOrdinal(date)
              const recordedAt = (options.now ?? currentScheduleInstantUnsafe)()
              const result = database
                .update(userSettings)
                .set({
                  lastScheduledLocalDate: date,
                  lastScheduledDay: day,
                  lastScheduledCompletion: sql`json_object('source', 'recorded', 'localDate', ${date}, 'recordedAt', ${recordedAt}, 'timeZone', ${userSettings.scheduleTimeZone})`,
                })
                .where(
                  and(
                    eq(userSettings.ownerId, ownerId),
                    or(
                      isNull(userSettings.lastScheduledDay),
                      lt(userSettings.lastScheduledDay, day)
                    )
                  )
                )
                .run()
              if (result.changes === 0) {
                const current = database
                  .select({ day: userSettings.lastScheduledDay })
                  .from(userSettings)
                  .where(eq(userSettings.ownerId, ownerId))
                  .get()
                if (
                  current?.day !== null &&
                  current?.day !== undefined &&
                  current.day > day
                )
                  options.observeSuppression?.("stale_completion")
              }
            },
            catch: () => failure("MarkScheduled"),
          })
        ),
        Effect.asVoid,
        Effect.withSpan(
          "sqlite identity_settings mark_scheduled",
          spanOptions("UPDATE")
        )
      )

    return deepFreeze({ find, save, listEnabled, markScheduled })
  })
