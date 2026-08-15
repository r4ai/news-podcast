import { sql } from "drizzle-orm"
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Identityが所有する唯一のテーブル。
 * user / session / account / verification は Better Auth が自身の
 * マイグレーションで所有しており、ここには意図的に書かない。
 */
export const userSettings = sqliteTable(
  "user_settings",
  {
    ownerId: text("owner_id").primaryKey(),
    scheduleEnabled: integer("schedule_enabled").notNull().default(0),
    scheduleLocalTime: text("schedule_local_time").notNull().default("07:30"),
    scheduleTimeZone: text("schedule_time_zone")
      .notNull()
      .default("Asia/Tokyo"),
    lastScheduledLocalDate: text("last_scheduled_local_date"),
  },
  (table) => [
    check(
      "user_settings_schedule_enabled_check",
      sql`${table.scheduleEnabled} IN (0, 1)`
    ),
  ]
)
