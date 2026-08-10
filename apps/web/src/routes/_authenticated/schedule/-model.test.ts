import { describe, expect, it } from "vitest"

import { isSubmittable, supportedTimeZones } from "./-model"

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
})
