import { describe, expect, it } from "vitest"

import {
  classifyProviderFailure,
  decideProviderRetry,
  parseRetryAfterMillis,
  type ProviderFailure,
  type ProviderRetryPolicy,
} from "./provider-reliability.js"

const now = Date.parse("2026-08-13T00:00:00.000Z")

const policy: ProviderRetryPolicy = {
  maximumAttempts: 4,
  maximumElapsedMillis: 30_000,
  baseDelayMillis: 1_000,
  maximumDelayMillis: 10_000,
}

describe("provider failure classification", () => {
  it.each([
    [{ _tag: "HttpFailure", status: 429 }, "RateLimited", true],
    [{ _tag: "HttpFailure", status: 500 }, "Unavailable", true],
    [{ _tag: "HttpFailure", status: 599 }, "Unavailable", true],
    [{ _tag: "Timeout" }, "Timeout", true],
    [{ _tag: "TransportFailure" }, "Unavailable", true],
    [{ _tag: "Incomplete" }, "Incomplete", true],
    [{ _tag: "MalformedResponse" }, "MalformedResponse", false],
    [{ _tag: "Refusal" }, "Refusal", false],
    [{ _tag: "Canceled" }, "Canceled", false],
    [{ _tag: "HttpFailure", status: 400 }, "ClientError", false],
    [{ _tag: "HttpFailure", status: 408 }, "ClientError", false],
    [{ _tag: "HttpFailure", status: 499 }, "ClientError", false],
  ] as const)(
    "classifies $0 as %s (retryable=%s)",
    (failure, reason, retryable) => {
      expect(classifyProviderFailure(failure, now)).toMatchObject({
        reason,
        retryable,
      })
    }
  )

  it("uses a valid Retry-After value for retryable HTTP failures", () => {
    expect(
      classifyProviderFailure(
        { _tag: "HttpFailure", status: 429, retryAfter: "7" },
        now
      )
    ).toEqual({
      retryable: true,
      reason: "RateLimited",
      retryAfterMillis: 7_000,
    })
    expect(
      classifyProviderFailure(
        { _tag: "HttpFailure", status: 503, retryAfter: "7" },
        now
      )
    ).toEqual({
      retryable: true,
      reason: "Unavailable",
      retryAfterMillis: 7_000,
    })
  })

  it.each([
    ["5", 5_000],
    ["Thu, 13 Aug 2026 00:00:09 GMT", 9_000],
    ["Thu, 13 Aug 2026 00:00:00 GMT", 0],
    ["-1", undefined],
    ["1.5", undefined],
    ["not-a-date", undefined],
    [undefined, undefined],
  ] as const)(
    "parses Retry-After %s without reading the system clock",
    (value, expected) => {
      expect(parseRetryAfterMillis(value, now)).toBe(expected)
    }
  )
})

describe("bounded provider retry decision", () => {
  const decide = (
    failure: ProviderFailure,
    completedAttempts = 1,
    nowMillis = now
  ) =>
    decideProviderRetry({
      failure,
      completedAttempts,
      startedAtMillis: now,
      nowMillis,
      policy,
    })

  it.each([
    [{ _tag: "MalformedResponse" }, "NonRetryable"],
    [{ _tag: "Refusal" }, "NonRetryable"],
    [{ _tag: "HttpFailure", status: 401 }, "NonRetryable"],
  ] as const)("stops permanent failure %s", (failure, reason) => {
    expect(decide(failure)).toEqual({ _tag: "Stop", reason })
  })

  it("uses deterministic capped exponential delays for transient failures", () => {
    const failure = { _tag: "HttpFailure", status: 503 } as const

    expect(decide(failure, 1)).toEqual({ _tag: "Retry", delayMillis: 1_000 })
    expect(decide(failure, 2)).toEqual({ _tag: "Retry", delayMillis: 2_000 })
    expect(decide(failure, 3)).toEqual({ _tag: "Retry", delayMillis: 4_000 })
  })

  it("honors Retry-After without retrying sooner than requested", () => {
    expect(
      decide({ _tag: "HttpFailure", status: 429, retryAfter: "7" })
    ).toEqual({ _tag: "Retry", delayMillis: 7_000 })
  })

  it.each([
    [{ _tag: "HttpFailure", status: 503 } as const, 4, now, "AttemptLimit"],
    [
      { _tag: "HttpFailure", status: 503 } as const,
      1,
      now + 29_500,
      "ElapsedTimeLimit",
    ],
    [
      { _tag: "HttpFailure", status: 429, retryAfter: "11" } as const,
      1,
      now,
      "RetryDelayLimit",
    ],
  ] as const)(
    "stops a retryable failure when the bounded budget reaches %s",
    (failure, completedAttempts, nowMillis, reason) => {
      expect(decide(failure, completedAttempts, nowMillis)).toEqual({
        _tag: "Stop",
        reason,
      })
    }
  )
})
