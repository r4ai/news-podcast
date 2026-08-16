import { Duration } from "effect"
import { AiError } from "effect/unstable/ai"
import { describe, expect, it } from "vitest"

import { toAiRuntimeFailure } from "./failure.js"

const wrap = (reason: AiError.AiError["reason"]): AiError.AiError =>
  new AiError.AiError({ module: "test", method: "generateObject", reason })

describe("Effect AI failure projection", () => {
  it("preserves bounded Retry-After semantics for 429", () => {
    expect(
      toAiRuntimeFailure(
        wrap(new AiError.RateLimitError({ retryAfter: Duration.millis(1_001) }))
      )
    ).toEqual({ _tag: "HttpFailure", status: 429, retryAfter: "2" })
  })

  it.each([
    [new AiError.ContentPolicyError({ description: "refused" }), "Refusal"],
    [
      new AiError.InvalidOutputError({ description: "schema" }),
      "MalformedResponse",
    ],
    [
      new AiError.StructuredOutputError({
        description: "schema",
        responseText: "{}",
      }),
      "MalformedResponse",
    ],
    [
      new AiError.NetworkError({
        reason: "TransportError",
        request: {
          method: "POST",
          url: "https://example.test",
          urlParams: [],
          headers: {},
        },
      }),
      "TransportFailure",
    ],
  ] as const)("maps %s without leaking provider details", (reason, tag) => {
    expect(toAiRuntimeFailure(wrap(reason))).toEqual({ _tag: tag })
  })
})
