import { describe, expect, it } from "vitest"

import {
  InvalidIdempotencyKeyError,
  validateIdempotencyKey,
} from "./idempotency-key.js"

describe("Idempotency-Key", () => {
  it.each(["request-123", " ", "x".repeat(255)])("accepts %j", (value) => {
    expect(validateIdempotencyKey(value)).toBe(value)
  })

  it.each(["", "x".repeat(256), "line\nbreak", "日本語"])(
    "rejects %j",
    (value) => {
      expect(() => validateIdempotencyKey(value)).toThrow(
        InvalidIdempotencyKeyError,
      )
    },
  )
})
