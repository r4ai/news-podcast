import { describe, expect, it, vi } from "vitest"

import { recordProviderConfiguration } from "./provider-configuration.js"

describe("provider configuration telemetry", () => {
  it.each([
    ["development", "fake"],
    ["production", "live"],
  ] as const)(
    "records app.env=%s provider.mode=%s",
    (appEnvironment, providerMode) => {
      const log = vi.fn()
      const gauge = vi.fn()

      recordProviderConfiguration(
        { log, gauge },
        { appEnvironment, providerMode }
      )

      const attributes = {
        "app.env": appEnvironment,
        "deployment.environment": appEnvironment,
        "provider.mode": providerMode,
      }
      expect(log).toHaveBeenCalledWith({
        name: "provider.configuration",
        attributes,
      })
      expect(gauge).toHaveBeenCalledWith(
        "provider.configuration",
        1,
        attributes
      )
    }
  )
})
