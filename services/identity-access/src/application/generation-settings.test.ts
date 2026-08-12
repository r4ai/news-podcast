import { Effect, Option } from "effect"
import { describe, expect, it, vi } from "vitest"

import { parseUserId } from "../domain/actor.js"
import { parseGenerationSchedule } from "../domain/generation-settings.js"
import {
  completeScheduledGeneration,
  findDueGenerationSchedules,
  getGenerationSettings,
  updateGenerationSettings,
  type GenerationSettingsRepository,
} from "./generation-settings.js"

describe("generation settings use cases", () => {
  it("returns the default state when an owner has no row", async () => {
    const ownerId = await Effect.runPromise(parseUserId("owner-a"))
    const repository: GenerationSettingsRepository = {
      find: vi.fn(() => Effect.succeed(Option.none())),
      save: vi.fn(),
      listEnabled: vi.fn(),
      markScheduled: vi.fn(),
    }

    const result = await Effect.runPromise(
      getGenerationSettings(repository)(ownerId)
    )

    expect(result).toEqual({
      enabled: false,
      localTime: "07:30",
      timeZone: "Asia/Tokyo",
    })
    expect(repository.find).toHaveBeenCalledWith(ownerId)
  })

  it("selects enabled owners once their local scheduled minute has arrived", async () => {
    const tokyoOwner = await Effect.runPromise(parseUserId("tokyo-owner"))
    const newYorkOwner = await Effect.runPromise(parseUserId("new-york-owner"))
    const tokyo = await Effect.runPromise(
      parseGenerationSchedule({
        enabled: true,
        localTime: "07:30",
        timeZone: "Asia/Tokyo",
      })
    )
    const newYork = await Effect.runPromise(
      parseGenerationSchedule({
        enabled: true,
        localTime: "23:00",
        timeZone: "America/New_York",
      })
    )
    const repository: GenerationSettingsRepository = {
      find: vi.fn(),
      save: vi.fn(),
      listEnabled: vi.fn(() =>
        Effect.succeed([
          { ownerId: tokyoOwner, schedule: tokyo },
          { ownerId: newYorkOwner, schedule: newYork },
        ])
      ),
      markScheduled: vi.fn(),
    }

    const due = await Effect.runPromise(
      findDueGenerationSchedules(repository)("2026-08-13T00:00:00.000Z")
    )

    expect(due).toEqual([{ ownerId: tokyoOwner, localDate: "2026-08-13" }])
  })

  it("does not select an owner before local time or twice on the same local date", async () => {
    const ownerId = await Effect.runPromise(parseUserId("owner-a"))
    const schedule = await Effect.runPromise(
      parseGenerationSchedule({
        enabled: true,
        localTime: "09:01",
        timeZone: "UTC",
      })
    )
    const alreadyCompletedSchedule = await Effect.runPromise(
      parseGenerationSchedule({
        enabled: true,
        localTime: "08:00",
        timeZone: "UTC",
      })
    )
    const repository: GenerationSettingsRepository = {
      find: vi.fn(),
      save: vi.fn(),
      listEnabled: vi.fn(() =>
        Effect.succeed([
          { ownerId, schedule },
          {
            ownerId,
            schedule: alreadyCompletedSchedule,
            lastScheduledLocalDate: "2026-08-13",
          },
        ])
      ),
      markScheduled: vi.fn(),
    }

    expect(
      await Effect.runPromise(
        findDueGenerationSchedules(repository)("2026-08-13T09:00:00.000Z")
      )
    ).toEqual([])
  })

  it("records the local date only after the caller completes job creation", async () => {
    const ownerId = await Effect.runPromise(parseUserId("owner-a"))
    const repository: GenerationSettingsRepository = {
      find: vi.fn(),
      save: vi.fn(),
      listEnabled: vi.fn(),
      markScheduled: vi.fn(() => Effect.void),
    }

    await Effect.runPromise(
      completeScheduledGeneration(repository)({
        ownerId,
        localDate: "2026-08-13",
      })
    )

    expect(repository.markScheduled).toHaveBeenCalledWith(ownerId, "2026-08-13")
  })

  it("returns an owner's stored state", async () => {
    const ownerId = await Effect.runPromise(parseUserId("owner-a"))
    const stored = await Effect.runPromise(
      parseGenerationSchedule({
        enabled: true,
        localTime: "06:45",
        timeZone: "UTC",
      })
    )
    const repository: GenerationSettingsRepository = {
      find: vi.fn(() => Effect.succeed(Option.some(stored))),
      save: vi.fn(),
      listEnabled: vi.fn(),
      markScheduled: vi.fn(),
    }

    expect(
      await Effect.runPromise(getGenerationSettings(repository)(ownerId))
    ).toEqual(stored)
  })

  it("persists and returns a complete replacement", async () => {
    const ownerId = await Effect.runPromise(parseUserId("owner-a"))
    const schedule = await Effect.runPromise(
      parseGenerationSchedule({
        enabled: true,
        localTime: "05:15",
        timeZone: "Europe/Paris",
      })
    )
    const repository: GenerationSettingsRepository = {
      find: vi.fn(),
      save: vi.fn((_ownerId, value) => Effect.succeed(value)),
      listEnabled: vi.fn(),
      markScheduled: vi.fn(),
    }

    const result = await Effect.runPromise(
      updateGenerationSettings(repository)({ ownerId, schedule })
    )

    expect(result).toEqual(schedule)
    expect(repository.save).toHaveBeenCalledWith(ownerId, schedule)
    expect(repository.find).not.toHaveBeenCalled()
  })
})
