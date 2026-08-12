import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  defaultGenerationSchedule,
  parseGenerationSchedule,
} from "./generation-settings.js"

describe("generation schedule", () => {
  it("accepts the complete valid state and freezes it", async () => {
    const schedule = await Effect.runPromise(
      parseGenerationSchedule({
        enabled: true,
        localTime: "23:59",
        timeZone: "America/New_York",
      })
    )

    expect(schedule).toEqual({
      enabled: true,
      localTime: "23:59",
      timeZone: "America/New_York",
    })
    expect(Object.isFrozen(schedule)).toBe(true)
  })

  it.each([
    ["hour overflow", { enabled: true, localTime: "24:00", timeZone: "UTC" }],
    ["minute overflow", { enabled: true, localTime: "07:60", timeZone: "UTC" }],
    ["non-padded time", { enabled: true, localTime: "7:30", timeZone: "UTC" }],
    [
      "unknown time zone",
      { enabled: true, localTime: "07:30", timeZone: "Mars/Olympus" },
    ],
    ["empty time zone", { enabled: true, localTime: "07:30", timeZone: "" }],
    [
      "unknown field",
      { enabled: true, localTime: "07:30", timeZone: "UTC", debug: true },
    ],
  ])("rejects %s", async (_case, input) => {
    expect(
      (await Effect.runPromiseExit(parseGenerationSchedule(input)))._tag
    ).toBe("Failure")
  })

  it("provides the legacy-compatible initial state", () => {
    expect(defaultGenerationSchedule).toEqual({
      enabled: false,
      localTime: "07:30",
      timeZone: "Asia/Tokyo",
    })
    expect(Object.isFrozen(defaultGenerationSchedule)).toBe(true)
  })
})
