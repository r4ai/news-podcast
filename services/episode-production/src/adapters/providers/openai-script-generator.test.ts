import { makeFakeLanguageModelLayer } from "@news-podcast/ai-runtime/testing"
import { Duration, Effect } from "effect"
import { AiError } from "effect/unstable/ai"
import { describe, expect, it } from "vitest"

import type { ProviderRetryPolicy } from "../../domain/provider-reliability.js"
import { makeOpenAiScriptGenerator } from "./openai-script-generator.js"

const policy: ProviderRetryPolicy = {
  maximumAttempts: 2,
  maximumElapsedMillis: 10_000,
  baseDelayMillis: 25,
  maximumDelayMillis: 2_000,
}
const source = {
  title: "境界テスト記事",
  url: "https://example.test/article",
  markdown: "外部provider境界を安全に検証する記事本文",
}
const success = {
  title: "今日のニュース",
  script: "境界の検証結果をお伝えします。".repeat(5),
  source_ids: ["source-1"],
}
const config = {
  apiUrl: new URL("https://api.openai.com/v1"),
  apiKey: "test-only-key",
  model: "test-model",
  requestTimeoutMillis: 1_000,
  retryPolicy: policy,
}

describe("Effect AI ScriptGenerator", () => {
  it("generates a frozen structured script and sends bounded source context", async () => {
    let prompt = ""
    const generator = makeOpenAiScriptGenerator(config, {
      languageModelLayer: makeFakeLanguageModelLayer((options) => {
        prompt = JSON.stringify(options.prompt)
        return Effect.succeed(success)
      }),
    })

    const draft = await Effect.runPromise(
      generator.generate({
        sources: [{ ...source, markdown: "長".repeat(6_001) }],
        interestProfile: { include: "AI", exclude: "広告" },
      })
    )

    expect(draft).toEqual({
      title: success.title,
      script: success.script,
      sourceUrls: [source.url],
    })
    expect(Object.isFrozen(draft)).toBe(true)
    expect(prompt).toContain("interest_profile")
    expect(prompt.match(/長/g) ?? []).toHaveLength(6_000)
    expect(prompt).not.toContain(config.apiKey)
  })

  it.each([
    { ...success, source_ids: ["source-1", "source-1"] },
    { ...success, source_ids: ["source-2"] },
  ])("rejects sources outside the materialized set", async (value) => {
    const generator = makeOpenAiScriptGenerator(config, {
      languageModelLayer: makeFakeLanguageModelLayer(() =>
        Effect.succeed(value)
      ),
    })
    await expect(
      Effect.runPromise(Effect.flip(generator.generate({ sources: [source] })))
    ).resolves.toEqual({ _tag: "MalformedResponse" })
  })

  it("maps opaque source ids back to the persisted URL spelling", async () => {
    const unicodeSource = {
      ...source,
      url: "https://example.test/日本語/記事",
    }
    const generator = makeOpenAiScriptGenerator(config, {
      languageModelLayer: makeFakeLanguageModelLayer(() =>
        Effect.succeed({
          ...success,
          source_ids: ["source-1"],
        })
      ),
    })

    const generated = await Effect.runPromise(
      generator.generate({ sources: [unicodeSource] })
    )

    expect(generated.sourceUrls).toEqual([unicodeSource.url])
  })

  it("feeds Effect AI rate limits into the existing Retry-After policy", async () => {
    let attempts = 0
    const delays: number[] = []
    const generator = makeOpenAiScriptGenerator(config, {
      languageModelLayer: makeFakeLanguageModelLayer(() => {
        attempts += 1
        return attempts === 1
          ? Effect.fail(
              new AiError.AiError({
                module: "test",
                method: "generateObject",
                reason: new AiError.RateLimitError({
                  retryAfter: Duration.seconds(2),
                }),
              })
            )
          : Effect.succeed(success)
      }),
      retryRuntime: {
        nowMillis: () => Effect.succeed(0),
        sleep: (milliseconds) =>
          Effect.sync(() => {
            delays.push(milliseconds)
          }),
      },
    })

    await Effect.runPromise(generator.generate({ sources: [source] }))

    expect(attempts).toBe(2)
    expect(delays).toEqual([2_000])
  })

  it("honors caller cancellation while the model is running", async () => {
    const controller = new AbortController()
    const generator = makeOpenAiScriptGenerator(config, {
      languageModelLayer: makeFakeLanguageModelLayer(() => Effect.never),
    })
    const pending = Effect.runPromise(
      Effect.flip(
        generator.generate({ sources: [source], signal: controller.signal })
      )
    )
    controller.abort()
    await expect(pending).resolves.toEqual({ _tag: "Canceled" })
  })
})
