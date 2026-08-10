import { describe, expect, it } from "vitest"

import { setTelemetryEnabled, telemetryEnabled } from "./preference"

describe("browser telemetry preference", () => {
  it("is enabled by default and persists an explicit opt-out", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    expect(telemetryEnabled(storage, null)).toBe(true)
    setTelemetryEnabled(false, storage)
    expect(telemetryEnabled(storage, null)).toBe(false)
    expect(telemetryEnabled(storage, "1")).toBe(false)
  })
})
