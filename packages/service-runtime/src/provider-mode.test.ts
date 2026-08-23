import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { readProviderRuntimeMode } from "./provider-mode.js"

describe("provider runtime mode", () => {
  it.each([
    ["development", undefined, "fake"],
    ["development", "fake", "fake"],
    ["development", "live", "live"],
    ["test", "fake", "fake"],
    ["test", "live", "live"],
    ["production", "live", "live"],
  ] as const)(
    "accepts APP_ENV=%s PROVIDER_MODE=%s as %s",
    async (appEnvironment, providerMode, expected) => {
      const config = await Effect.runPromise(
        readProviderRuntimeMode({
          APP_ENV: appEnvironment,
          PROVIDER_MODE: providerMode,
        })
      )

      expect(config).toEqual({
        appEnvironment,
        providerMode: expected,
      })
      expect(Object.isFrozen(config)).toBe(true)
    }
  )

  it.each([
    ["production", undefined],
    ["production", "fake"],
    ["production", "typo"],
    ["production", "Live"],
    ["development", "typo"],
    ["staging", "live"],
  ] as const)(
    "rejects APP_ENV=%s PROVIDER_MODE=%s",
    async (appEnvironment, providerMode) => {
      const exit = await Effect.runPromiseExit(
        readProviderRuntimeMode({
          APP_ENV: appEnvironment,
          PROVIDER_MODE: providerMode,
        })
      )

      expect(exit._tag).toBe("Failure")
    }
  )
})
