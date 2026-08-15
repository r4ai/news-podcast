import { describe, expect, it } from "vitest"

import {
  isSubmittable,
  supportedTimeZones,
  timeZoneLabel,
  timeZoneOptions,
} from "./-model"

describe("schedule model", () => {
  it("keeps the saved zone selectable even when the runtime does not list it", () => {
    const zones = supportedTimeZones("Mars/Olympus")
    expect(zones).toContain("Mars/Olympus")
    expect(zones).toContain("Asia/Tokyo")
    expect(zones).toContain("UTC")
  })

  it("does not repeat zones that the runtime already provides", () => {
    const zones = supportedTimeZones("Asia/Tokyo")
    expect(zones.filter((zone) => zone === "Asia/Tokyo")).toHaveLength(1)
  })

  it("blocks submission until both time and zone are present", () => {
    const draft = { enabled: true, localTime: "07:30", timeZone: "UTC" }
    expect(isSubmittable(draft)).toBe(true)
    expect(isSubmittable({ ...draft, timeZone: "" })).toBe(false)
    expect(isSubmittable({ ...draft, localTime: "" })).toBe(false)
  })

  it("labels a zone with its current UTC offset", () => {
    const summerInJapan = new Date("2026-08-15T00:00:00Z")
    expect(timeZoneLabel("Asia/Tokyo", summerInJapan)).toBe(
      "Asia/Tokyo (UTC+9)"
    )
    expect(timeZoneLabel("UTC", summerInJapan)).toBe("UTC (UTC+0)")
  })

  it("falls back to the raw zone name when it cannot be formatted", () => {
    expect(timeZoneLabel("Mars/Olympus")).toBe("Mars/Olympus")
  })

  it("builds value/label options sharing a single timestamp", () => {
    const now = new Date("2026-08-15T00:00:00Z")
    expect(timeZoneOptions(["Asia/Tokyo", "UTC"], now)).toEqual([
      { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
      { value: "UTC", label: "UTC (UTC+0)" },
    ])
  })
})
