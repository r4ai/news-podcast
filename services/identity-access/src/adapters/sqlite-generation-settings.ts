import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Option, Schema } from "effect"

import type {
  GenerationSettingsRepository,
  GenerationSettingsStoreError,
  ScheduledOwner,
} from "../application/generation-settings.js"
import { UserIdSchema } from "../domain/actor.js"
import { GenerationScheduleSchema } from "../domain/generation-settings.js"
import type { IdentitySqlitePort } from "./sqlite-port.js"

const schema = `
CREATE TABLE IF NOT EXISTS user_settings (
  owner_id TEXT PRIMARY KEY,
  schedule_enabled INTEGER NOT NULL DEFAULT 0 CHECK (schedule_enabled IN (0, 1)),
  schedule_local_time TEXT NOT NULL DEFAULT '07:30',
  schedule_time_zone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  last_scheduled_local_date TEXT
);`

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

const select = `SELECT owner_id AS ownerId,
                       schedule_enabled AS enabled,
                       schedule_local_time AS localTime,
                       schedule_time_zone AS timeZone,
                       last_scheduled_local_date AS lastScheduledLocalDate
                  FROM user_settings`

const spanOptions = (operation: string) => ({
  kind: "client" as const,
  attributes: {
    "db.system.name": "sqlite",
    "db.namespace": "identity-access",
    "db.operation.name": operation,
  },
})

export const createSqliteGenerationSettingsRepository = (
  database: IdentitySqlitePort
): Effect.Effect<GenerationSettingsRepository, GenerationSettingsStoreError> =>
  Effect.try({
    try: () => database.execute(schema),
    catch: () => failure("Save"),
  }).pipe(
    Effect.map(() => {
      const find: GenerationSettingsRepository["find"] = (ownerId) =>
        Effect.try({
          try: () =>
            database.get(`${select} WHERE owner_id = ? LIMIT 1`, [ownerId]),
          catch: () => failure("Find"),
        }).pipe(
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.succeed(Option.none())
              : decodeRow(row, "Find").pipe(
                  Effect.map(({ schedule }) => Option.some(schedule))
                )
          ),
          Effect.withSpan(
            "sqlite identity_settings find",
            spanOptions("SELECT")
          )
        )

      const save: GenerationSettingsRepository["save"] = (ownerId, schedule) =>
        Effect.try({
          try: () => {
            database.run(
              `INSERT INTO user_settings
                 (owner_id, schedule_enabled, schedule_local_time, schedule_time_zone)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(owner_id) DO UPDATE SET
                 schedule_enabled = excluded.schedule_enabled,
                 schedule_local_time = excluded.schedule_local_time,
                 schedule_time_zone = excluded.schedule_time_zone`,
              [
                ownerId,
                schedule.enabled ? 1 : 0,
                schedule.localTime,
                schedule.timeZone,
              ]
            )
            return schedule
          },
          catch: () => failure("Save"),
        }).pipe(
          Effect.map(deepFreeze),
          Effect.withSpan(
            "sqlite identity_settings save",
            spanOptions("UPSERT")
          )
        )

      const listEnabled: GenerationSettingsRepository["listEnabled"] = () =>
        Effect.try({
          try: () => database.all(`${select} WHERE schedule_enabled = 1`),
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
          try: () => {
            database.run(
              "UPDATE user_settings SET last_scheduled_local_date = ? WHERE owner_id = ?",
              [localDate, ownerId]
            )
          },
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
  )
