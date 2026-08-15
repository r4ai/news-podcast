import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { UserIdSchema } from "../../../domain/actor.js"
import { GenerationScheduleSchema } from "../../../domain/generation-settings.js"
import { openIdentityDatabaseUnsafe } from "../../../infrastructure/unsafe/drizzle/open.js"
import { createGenerationSettingsRepository } from "./repository.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
) => Schema.decodeUnknownSync(schema)(input)
const ownerA = decode(UserIdSchema, "owner-a")
const ownerB = decode(UserIdSchema, "owner-b")
const first = decode(GenerationScheduleSchema, {
  enabled: true,
  localTime: "06:30",
  timeZone: "Asia/Tokyo",
})
const replacement = decode(GenerationScheduleSchema, {
  enabled: false,
  localTime: "18:05",
  timeZone: "Europe/London",
})

describe("generation settings repository", () => {
  it("transitions absent -> saved -> replaced for one owner", async () => {
    const handle = openIdentityDatabaseUnsafe(":memory:")
    try {
      const repository = await Effect.runPromise(
        createGenerationSettingsRepository(handle.database)
      )

      expect((await Effect.runPromise(repository.find(ownerA)))._tag).toBe(
        "None"
      )
      expect(await Effect.runPromise(repository.save(ownerA, first))).toEqual(
        first
      )
      expect(
        await Effect.runPromise(repository.save(ownerA, replacement))
      ).toEqual(replacement)
      const found = await Effect.runPromise(repository.find(ownerA))
      expect(found._tag).toBe("Some")
      if (found._tag === "Some") expect(found.value).toEqual(replacement)
    } finally {
      handle.close()
    }
  })

  it("keeps owners isolated across reads and writes", async () => {
    const handle = openIdentityDatabaseUnsafe(":memory:")
    try {
      const repository = await Effect.runPromise(
        createGenerationSettingsRepository(handle.database)
      )
      await Effect.runPromise(repository.save(ownerA, first))
      await Effect.runPromise(repository.save(ownerB, replacement))

      const foundA = await Effect.runPromise(repository.find(ownerA))
      const foundB = await Effect.runPromise(repository.find(ownerB))
      expect(foundA._tag === "Some" && foundA.value).toEqual(first)
      expect(foundB._tag === "Some" && foundB.value).toEqual(replacement)
    } finally {
      handle.close()
    }
  })

  it("lists only enabled owners and persists the completed local date", async () => {
    const handle = openIdentityDatabaseUnsafe(":memory:")
    try {
      const repository = await Effect.runPromise(
        createGenerationSettingsRepository(handle.database)
      )
      await Effect.runPromise(repository.save(ownerA, first))
      await Effect.runPromise(repository.save(ownerB, replacement))

      expect(await Effect.runPromise(repository.listEnabled())).toEqual([
        { ownerId: ownerA, schedule: first },
      ])

      await Effect.runPromise(repository.markScheduled(ownerA, "2026-08-13"))
      expect(await Effect.runPromise(repository.listEnabled())).toEqual([
        {
          ownerId: ownerA,
          schedule: first,
          lastScheduledLocalDate: "2026-08-13",
        },
      ])
    } finally {
      handle.close()
    }
  })

  it("maps a malformed persisted row to a typed corruption failure", async () => {
    const handle = openIdentityDatabaseUnsafe(":memory:")
    try {
      const repository = await Effect.runPromise(
        createGenerationSettingsRepository(handle.database)
      )
      handle.client
        .prepare(
          `INSERT INTO user_settings(owner_id, schedule_enabled, schedule_local_time, schedule_time_zone)
           VALUES (?, ?, ?, ?)`
        )
        .run(ownerA, 1, "99:99", "UTC")

      const exit = await Effect.runPromiseExit(repository.find(ownerA))
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        expect(String(exit.cause)).toContain("GenerationSettingsStoreFailed")
        expect(String(exit.cause)).toContain("CorruptRecord")
      }
    } finally {
      handle.close()
    }
  })

  it("does not silently coerce a corrupt enabled flag to disabled", async () => {
    const handle = openIdentityDatabaseUnsafe(":memory:")
    try {
      const repository = await Effect.runPromise(
        createGenerationSettingsRepository(handle.database)
      )
      handle.client.exec("PRAGMA ignore_check_constraints = ON")
      handle.client
        .prepare(
          `INSERT INTO user_settings(owner_id, schedule_enabled, schedule_local_time, schedule_time_zone)
           VALUES (?, ?, ?, ?)`
        )
        .run(ownerA, 2, "07:30", "UTC")

      const exit = await Effect.runPromiseExit(repository.find(ownerA))
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure")
        expect(String(exit.cause)).toContain("CorruptRecord")
    } finally {
      handle.close()
    }
  })

  it("uses the legacy-compatible user_settings columns", async () => {
    const handle = openIdentityDatabaseUnsafe(":memory:")
    try {
      const repository = await Effect.runPromise(
        createGenerationSettingsRepository(handle.database)
      )
      await Effect.runPromise(repository.save(ownerA, first))
      expect(
        handle.client
          .prepare(
            `SELECT schedule_enabled AS enabled,
                    schedule_local_time AS localTime,
                    schedule_time_zone AS timeZone
               FROM user_settings WHERE owner_id = ?`
          )
          .get(ownerA)
      ).toEqual({ enabled: 1, localTime: "06:30", timeZone: "Asia/Tokyo" })
    } finally {
      handle.close()
    }
  })
})
