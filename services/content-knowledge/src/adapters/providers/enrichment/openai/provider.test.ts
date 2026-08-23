import { makeFakeLanguageModelLayer } from "@news-podcast/ai-runtime/testing"
import { Duration, Effect } from "effect"
import { AiError } from "effect/unstable/ai"
import { describe, expect, it } from "vitest"

import { makeOpenAiEnrichmentProvider } from "./provider.js"

const input = {
  articleId: "5af55f2e-ff0b-475c-866a-f2cff48c101d",
  title: "境界テスト記事",
  markdown: "providerへ渡す記事本文",
  interestProfile: { include: "TypeScriptと型安全性", exclude: "" },
  tagVocabulary: ["技術", "経済"],
}
const payload = {
  summary: "型安全な境界についての記事です。",
  score: 90,
  reason: "関心トピックと一致します。",
  tags: ["技術"],
  suggestedTags: ["型安全"],
}
const config = {
  apiUrl: new URL("https://api.openai.com/v1"),
  apiKey: "test-only-key",
  model: "gpt-test",
  requestTimeoutMillis: 1_000,
}

describe("Effect AI enrichment provider", () => {
  it("generates only schema-validated domain fields and provider usage", async () => {
    let prompt = ""
    const provider = makeOpenAiEnrichmentProvider(config, {
      languageModelLayer: makeFakeLanguageModelLayer((options) => {
        prompt = JSON.stringify(options.prompt)
        return Effect.succeed(payload)
      }),
    })

    const result = await Effect.runPromise(provider.enrich(input))

    expect(result).toEqual({ ...payload, tokensIn: 0, tokensOut: 0 })
    expect(Object.isFrozen(result)).toBe(true)
    expect(prompt).toContain(input.markdown)
    expect(prompt).toContain(input.interestProfile.include)
    expect(prompt).not.toContain(config.apiKey)
  })

  it("fails closed when the model selects a tag outside the vocabulary", async () => {
    const provider = makeOpenAiEnrichmentProvider(config, {
      languageModelLayer: makeFakeLanguageModelLayer(() =>
        Effect.succeed({ ...payload, tags: ["未登録"] })
      ),
    })

    const failure = await Effect.runPromise(Effect.flip(provider.enrich(input)))

    expect(failure).toEqual({
      _tag: "EnrichmentProviderFailed",
      reason: "Permanent",
      message: "invalid enrichment provider response",
    })
  })

  it("returns a retryable failure after one request so the durable queue reserves every retry", async () => {
    let attempts = 0
    const provider = makeOpenAiEnrichmentProvider(config, {
      languageModelLayer: makeFakeLanguageModelLayer(() => {
        attempts += 1
        return Effect.fail(
          new AiError.AiError({
            module: "test",
            method: "generateObject",
            reason: new AiError.RateLimitError({
              retryAfter: Duration.seconds(2),
            }),
          })
        )
      }),
    })

    await expect(
      Effect.runPromise(provider.enrich(input))
    ).rejects.toMatchObject({
      _tag: "EnrichmentProviderFailed",
      reason: "RateLimited",
    })

    expect(attempts).toBe(1)
  })

  it("classifies structured-output schema drift as permanent", async () => {
    const provider = makeOpenAiEnrichmentProvider(config, {
      languageModelLayer: makeFakeLanguageModelLayer(() =>
        Effect.succeed({ ...payload, score: "high" })
      ),
    })

    const failure = await Effect.runPromise(Effect.flip(provider.enrich(input)))

    expect(failure).toMatchObject({
      _tag: "EnrichmentProviderFailed",
      reason: "Permanent",
    })
  })
})
