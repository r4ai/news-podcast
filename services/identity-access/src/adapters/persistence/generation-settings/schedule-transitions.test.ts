import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { findDueGenerationSchedules } from "../../../application/generation-settings.js"
import { UserIdSchema } from "../../../domain/actor.js"
import { GenerationScheduleSchema } from "../../../domain/generation-settings.js"
import { openIdentityDatabaseUnsafe } from "../../../infrastructure/unsafe/drizzle/open.js"
import { createGenerationSettingsRepository } from "./repository.js"

const ownerId = Schema.decodeUnknownSync(UserIdSchema)("owner-a")
const schedule = (timeZone: string, localTime = "07:30", enabled = true) =>
  Schema.decodeUnknownSync(GenerationScheduleSchema)({
    enabled,
    timeZone,
    localTime,
  })
const cases = [
  [
    "normal next day",
    "Asia/Tokyo",
    "Asia/Tokyo",
    "2026-08-30",
    "07:30",
    "2026-08-30T22:30:00.000Z",
    "2026-08-31",
  ],
  [
    "date line backward -9",
    "Pacific/Kiritimati",
    "America/Adak",
    "2026-08-30",
    "07:30",
    "2026-08-30T08:00:00.000Z",
    undefined,
  ],
  [
    "date line backward -10",
    "Pacific/Kiritimati",
    "Pacific/Honolulu",
    "2026-08-30",
    "07:30",
    "2026-08-30T08:00:00.000Z",
    undefined,
  ],
  [
    "date line forward follows the new date",
    "America/Adak",
    "Pacific/Kiritimati",
    "2026-08-29",
    "07:30",
    "2026-08-30T08:00:00.000Z",
    "2026-08-30",
  ],
  [
    "backward resumes only beyond the completed date",
    "Pacific/Kiritimati",
    "America/Adak",
    "2026-08-30",
    "07:30",
    "2026-08-31T16:30:00.000Z",
    "2026-08-31",
  ],
  [
    "spring DST before the skipped minute",
    "America/New_York",
    "America/New_York",
    "2026-03-07",
    "02:30",
    "2026-03-08T06:59:00.000Z",
    undefined,
  ],
  [
    "spring DST catches up at first valid minute",
    "America/New_York",
    "America/New_York",
    "2026-03-07",
    "02:30",
    "2026-03-08T07:00:00.000Z",
    "2026-03-08",
  ],
  [
    "fall DST repeated clock is still the same day",
    "America/New_York",
    "America/New_York",
    "2026-11-01",
    "01:30",
    "2026-11-01T06:30:00.000Z",
    undefined,
  ],
  [
    "fall DST next day remains due",
    "America/New_York",
    "America/New_York",
    "2026-11-01",
    "01:30",
    "2026-11-02T06:30:00.000Z",
    "2026-11-02",
  ],
  [
    "time change cannot reopen the completed date",
    "UTC",
    "UTC",
    "2026-08-30",
    "12:00",
    "2026-08-30T13:00:00.000Z",
    undefined,
  ],
] as const

describe("daily completion transitions across schedule changes", () => {
  it.each(cases)(
    "%s",
    async (
      _name,
      previousZone,
      zone,
      completedDate,
      time,
      instant,
      expectedDate
    ) => {
      const handle = openIdentityDatabaseUnsafe(":memory:")
      const observed: string[] = []
      try {
        const repository = await Effect.runPromise(
          createGenerationSettingsRepository(handle.database, {
            now: () => instant,
          })
        )
        await Effect.runPromise(
          repository.save(ownerId, schedule(previousZone))
        )
        await Effect.runPromise(
          repository.markScheduled(ownerId, completedDate)
        )
        await Effect.runPromise(repository.save(ownerId, schedule(zone, time)))
        const due = await Effect.runPromise(
          findDueGenerationSchedules(repository, (reason) =>
            observed.push(reason)
          )(instant)
        )
        expect(due).toEqual(
          expectedDate ? [{ ownerId, localDate: expectedDate }] : []
        )
        const completion = (
          await Effect.runPromise(repository.listEnabled())
        )[0]?.lastCompletion
        expect(completion).toEqual({
          source: "recorded",
          localDate: completedDate,
          recordedAt: instant,
          timeZone: previousZone,
        })
        if (_name.startsWith("date line backward"))
          expect(observed).toEqual(["past_local_day"])
        else expect(observed).toEqual([])
      } finally {
        handle.close()
      }
    }
  )

  it("retains completion over disable/enable and records stale completion suppression without owner labels", async () => {
    const handle = openIdentityDatabaseUnsafe(":memory:")
    const observed: string[] = []
    try {
      const repository = await Effect.runPromise(
        createGenerationSettingsRepository(handle.database, {
          now: () => "2026-08-30T08:00:00.000Z",
          observeSuppression: (reason) => observed.push(reason),
        })
      )
      await Effect.runPromise(repository.save(ownerId, schedule("UTC")))
      await Effect.runPromise(repository.markScheduled(ownerId, "2026-08-30"))
      await Effect.runPromise(
        repository.save(ownerId, schedule("UTC", "07:30", false))
      )
      expect(
        await Effect.runPromise(
          findDueGenerationSchedules(repository)("2026-08-30T09:00:00.000Z")
        )
      ).toEqual([])
      await Effect.runPromise(repository.save(ownerId, schedule("UTC")))
      expect(
        await Effect.runPromise(
          findDueGenerationSchedules(repository)("2026-08-30T09:00:00.000Z")
        )
      ).toEqual([])
      await Effect.runPromise(repository.markScheduled(ownerId, "2026-08-30"))
      await Effect.runPromise(repository.markScheduled(ownerId, "2026-08-29"))
      expect(observed).toEqual(["stale_completion"])
      expect(
        await Effect.runPromise(
          findDueGenerationSchedules(repository)("2026-08-31T07:30:00.000Z")
        )
      ).toEqual([{ ownerId, localDate: "2026-08-31" }])
    } finally {
      handle.close()
    }
  })

  it("applies time changes to an unfinished day without clearing a completion", async () => {
    const handle = openIdentityDatabaseUnsafe(":memory:")
    try {
      const repository = await Effect.runPromise(
        createGenerationSettingsRepository(handle.database)
      )
      await Effect.runPromise(
        repository.save(ownerId, schedule("UTC", "09:30"))
      )
      expect(
        await Effect.runPromise(
          findDueGenerationSchedules(repository)("2026-08-30T08:00:00.000Z")
        )
      ).toEqual([])
      await Effect.runPromise(
        repository.save(ownerId, schedule("UTC", "07:30"))
      )
      expect(
        await Effect.runPromise(
          findDueGenerationSchedules(repository)("2026-08-30T08:00:00.000Z")
        )
      ).toEqual([{ ownerId, localDate: "2026-08-30" }])
    } finally {
      handle.close()
    }
  })

  it("migrates legacy dates without inventing a historical timezone or instant", async () => {
    const client = new DatabaseSync(":memory:")
    try {
      client.exec(
        readFileSync(
          new URL(
            "../../../../drizzle/migrations/20260815015103_init/migration.sql",
            import.meta.url
          ),
          "utf8"
        )
      )
      client
        .prepare(
          "INSERT INTO user_settings(owner_id,schedule_enabled,last_scheduled_local_date) VALUES (?,1,?)"
        )
        .run(ownerId, "2026-08-30")
      client.exec(
        readFileSync(
          new URL(
            "../../../../drizzle/migrations/20260912104845_outgoing_ender_wiggin/migration.sql",
            import.meta.url
          ),
          "utf8"
        )
      )
      const repository = await Effect.runPromise(
        createGenerationSettingsRepository(drizzle({ client }))
      )
      expect(
        (await Effect.runPromise(repository.listEnabled()))[0]?.lastCompletion
      ).toEqual({ source: "legacy", localDate: "2026-08-30" })
      await Effect.runPromise(
        repository.save(ownerId, schedule("America/Adak"))
      )
      expect(
        await Effect.runPromise(
          findDueGenerationSchedules(repository)("2026-08-30T08:00:00.000Z")
        )
      ).toEqual([])
    } finally {
      client.close()
    }
  })

  it.each(["2026-02-30", "malformed"])(
    "rejects invalid persisted completion date %s",
    async (date) => {
      const handle = openIdentityDatabaseUnsafe(":memory:")
      try {
        const repository = await Effect.runPromise(
          createGenerationSettingsRepository(handle.database)
        )
        await Effect.runPromise(repository.save(ownerId, schedule("UTC")))
        handle.client
          .prepare(
            "UPDATE user_settings SET last_scheduled_local_date=?, last_scheduled_day=0"
          )
          .run(date)
        const failure = await Effect.runPromise(
          repository.listEnabled().pipe(Effect.flip)
        )
        expect(failure).toMatchObject({ reason: "CorruptRecord" })
      } finally {
        handle.close()
      }
    }
  )
})
