import { describe, expect, it } from "vitest"

import { decodeWatchdogState } from "./state.js"

describe("watchdog persisted state", () => {
  it("strictly restores the current format", () => {
    expect(
      decodeWatchdogState(
        JSON.stringify({
          failures: {},
          targets: {
            gateway: {
              up: true,
              consecutiveFailures: 0,
              lastSuccessAt: "2026-08-20T00:00:00.000Z",
            },
          },
        })
      )
    ).toEqual({
      failures: {},
      targets: {
        gateway: {
          up: true,
          consecutiveFailures: 0,
          lastSuccessAt: "2026-08-20T00:00:00.000Z",
        },
      },
    })
  })

  it.each(['{"failures":', '{"failures":{},"legacy":true}'])(
    "fails closed without echoing persisted content",
    (input) => {
      let failure: unknown
      try {
        decodeWatchdogState(input)
      } catch (cause) {
        failure = cause
      }
      expect(failure).toEqual({
        _tag: "DatabaseFailed",
        operation: "watchdog.state",
        reason: "CorruptRecord",
      })
      expect(String(failure)).not.toContain(input)
    }
  )
})
