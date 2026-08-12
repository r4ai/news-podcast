import { Effect, Option } from "effect"
import { describe, expect, it, vi } from "vitest"

import type { GenerationSettingsRepository } from "../application/generation-settings.js"
import {
  makeCompleteScheduledGenerationHandler,
  makeFindDueGenerationSchedulesHandler,
  makeGetGenerationSettingsHandler,
  makeUpdateGenerationSettingsHandler,
} from "./generation-settings-handler.js"

const repository = (): GenerationSettingsRepository => ({
  find: vi.fn(() => Effect.succeed(Option.none())),
  save: vi.fn((_ownerId, schedule) => Effect.succeed(schedule)),
  listEnabled: vi.fn(),
  markScheduled: vi.fn(),
})

describe("generation settings handlers", () => {
  it("parses an owner-scoped get request before invoking the use case", async () => {
    const store = repository()
    const result = await Effect.runPromise(
      makeGetGenerationSettingsHandler(store)({ ownerId: "owner-a" })
    )

    expect(result).toEqual({
      enabled: false,
      localTime: "07:30",
      timeZone: "Asia/Tokyo",
    })
    expect(store.find).toHaveBeenCalledWith("owner-a")
  })

  it("discovers due schedules from a validated UTC instant", async () => {
    const store = repository()
    vi.mocked(store.listEnabled).mockReturnValue(Effect.succeed([]))

    expect(
      await Effect.runPromise(
        makeFindDueGenerationSchedulesHandler(store)({
          instant: "2026-08-13T00:00:00.000Z",
        })
      )
    ).toEqual([])
    expect(store.listEnabled).toHaveBeenCalledOnce()
  })

  it("records a completed schedule from a validated owner and local date", async () => {
    const store = repository()
    vi.mocked(store.markScheduled).mockReturnValue(Effect.void)

    await Effect.runPromise(
      makeCompleteScheduledGenerationHandler(store)({
        ownerId: "owner-a",
        localDate: "2026-08-13",
      })
    )

    expect(store.markScheduled).toHaveBeenCalledWith("owner-a", "2026-08-13")
  })

  it.each([
    ["non-UTC instant", { instant: "2026-08-13T09:00:00+09:00" }],
    ["impossible instant", { instant: "2026-02-30T00:00:00.000Z" }],
    ["unknown field", { instant: "2026-08-13T00:00:00.000Z", debug: true }],
  ])("rejects malformed due discovery: %s", async (_case, input) => {
    const store = repository()
    const exit = await Effect.runPromiseExit(
      makeFindDueGenerationSchedulesHandler(store)(input)
    )
    expect(exit._tag).toBe("Failure")
    expect(store.listEnabled).not.toHaveBeenCalled()
  })

  it.each([
    ["impossible date", { ownerId: "owner-a", localDate: "2026-02-30" }],
    ["non-padded date", { ownerId: "owner-a", localDate: "2026-8-1" }],
    ["invalid owner", { ownerId: " ", localDate: "2026-08-13" }],
  ])("rejects malformed schedule completion: %s", async (_case, input) => {
    const store = repository()
    const exit = await Effect.runPromiseExit(
      makeCompleteScheduledGenerationHandler(store)(input)
    )
    expect(exit._tag).toBe("Failure")
    expect(store.markScheduled).not.toHaveBeenCalled()
  })

  it("parses and persists a complete update", async () => {
    const store = repository()
    const result = await Effect.runPromise(
      makeUpdateGenerationSettingsHandler(store)({
        ownerId: "owner-a",
        generationSchedule: {
          enabled: true,
          localTime: "10:20",
          timeZone: "Pacific/Auckland",
        },
      })
    )

    expect(result).toEqual({
      enabled: true,
      localTime: "10:20",
      timeZone: "Pacific/Auckland",
    })
    expect(store.save).toHaveBeenCalledWith("owner-a", result)
  })

  it.each([
    ["unknown owner field", { ownerId: "owner-a", debug: true }],
    ["blank owner", { ownerId: " " }],
  ])("rejects malformed get: %s", async (_case, input) => {
    const store = repository()
    const exit = await Effect.runPromiseExit(
      makeGetGenerationSettingsHandler(store)(input)
    )
    expect(exit._tag).toBe("Failure")
    expect(store.find).not.toHaveBeenCalled()
  })

  it.each([
    [
      "invalid local time",
      {
        ownerId: "owner-a",
        generationSchedule: {
          enabled: true,
          localTime: "25:00",
          timeZone: "UTC",
        },
      },
    ],
    [
      "invalid time zone",
      {
        ownerId: "owner-a",
        generationSchedule: {
          enabled: true,
          localTime: "07:30",
          timeZone: "Invalid/Zone",
        },
      },
    ],
    [
      "partial replacement",
      { ownerId: "owner-a", generationSchedule: { enabled: true } },
    ],
    [
      "unknown field",
      {
        ownerId: "owner-a",
        generationSchedule: {
          enabled: true,
          localTime: "07:30",
          timeZone: "UTC",
        },
        debug: true,
      },
    ],
  ])("rejects malformed update: %s", async (_case, input) => {
    const store = repository()
    const exit = await Effect.runPromiseExit(
      makeUpdateGenerationSettingsHandler(store)(input)
    )
    expect(exit._tag).toBe("Failure")
    expect(store.save).not.toHaveBeenCalled()
  })
})
