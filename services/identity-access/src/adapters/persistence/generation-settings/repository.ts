import { deepFreeze, parse } from "@news-podcast/kernel"
import { databaseSpanOptions } from "@news-podcast/persistence"
import { eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"

import { userSettings } from "../../../../drizzle/schema.js"
import type {
  GenerationSettingsRepository,
  GenerationSettingsStoreError,
  ScheduledOwner,
} from "../../../application/generation-settings.js"
import { UserIdSchema } from "../../../domain/actor.js"
import { GenerationScheduleSchema } from "../../../domain/generation-settings.js"
import type { IdentityDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"

const SettingsRowSchema = Schema.Struct({
  ownerId: Schema.String,
  enabled: Schema.Literals([0, 1]),
  localTime: Schema.String,
  timeZone: Schema.String,
  lastScheduledLocalDate: Schema.NullOr(Schema.String),
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
      Effect.all({
        ownerId: parse(UserIdSchema)(value.ownerId),
        schedule: parse(GenerationScheduleSchema)({
          enabled: value.enabled === 1,
          localTime: value.localTime,
          timeZone: value.timeZone,
        }),
      }).pipe(
        Effect.map(({ ownerId, schedule }): ScheduledOwner =>
          deepFreeze({
            ownerId,
            schedule,
            ...(value.lastScheduledLocalDate === null
              ? {}
              : { lastScheduledLocalDate: value.lastScheduledLocalDate }),
          })
        )
      )
    ),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

export const createGenerationSettingsRepository = (
  database: IdentityDatabase
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
      Effect.try({
        try: () =>
          database
            .update(userSettings)
            .set({ lastScheduledLocalDate: localDate })
            .where(eq(userSettings.ownerId, ownerId))
            .run(),
        catch: () => failure("MarkScheduled"),
      }).pipe(
        Effect.asVoid,
        Effect.withSpan(
          "sqlite identity_settings mark_scheduled",
          spanOptions("UPDATE")
        )
      )

    return deepFreeze({ find, save, listEnabled, markScheduled })
  })
