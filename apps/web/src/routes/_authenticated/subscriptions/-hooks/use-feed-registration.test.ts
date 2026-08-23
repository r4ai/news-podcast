import { describe, expect, it } from "vitest"

import {
  feedRegistrationErrorMessage,
  validateFeedUrlInput,
} from "./use-feed-registration"

describe("feed registration messages", () => {
  it.each([
    ["not a URL", "URLの形式が正しくありません。"],
    ["file:///etc/passwd", "安全上登録できないURLです。"],
    ["https://user:secret@example.com/feed", "安全上登録できないURLです。"],
    ["https://example.com/feed#private", "安全上登録できないURLです。"],
    ["https://example.com/feed#", "安全上登録できないURLです。"],
  ])("rejects invalid or forbidden input: %s", (input, expected) => {
    const result = validateFeedUrlInput(input)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toContain(expected)
  })

  it.each([
    ["invalid_subscription_request", "URLの形式が正しくありません。"],
    ["feed_subscription_rejected", "RSS/Atomフィードとして登録できません。"],
    ["feed_subscription_exists", "既に購読しています。"],
    ["upstream_unavailable", "現在フィードを登録できません。"],
  ])("distinguishes the %s response", (code, expected) => {
    expect(feedRegistrationErrorMessage({ code })).toContain(expected)
  })
})
