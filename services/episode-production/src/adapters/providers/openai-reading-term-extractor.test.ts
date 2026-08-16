import { makeFakeLanguageModelLayer } from "@news-podcast/ai-runtime/testing"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { makeOpenAiReadingTermExtractor } from "./openai-reading-term-extractor.js"

const config = {
  apiUrl: new URL("https://api.openai.com/v1"),
  apiKey: "test-key",
  model: "test-model",
  requestTimeoutMillis: 1_000,
  retryPolicy: {
    maximumAttempts: 1,
    maximumElapsedMillis: 10_000,
    baseDelayMillis: 10,
    maximumDelayMillis: 100,
  },
} as const

describe("Effect AI reading term extractor", () => {
  it("keeps only valid, unique terms that occur in the generated script", async () => {
    const extractor = makeOpenAiReadingTermExtractor(config, {
      languageModelLayer: makeFakeLanguageModelLayer(() =>
        Effect.succeed({
          terms: [
            { surface: "OpenAI", reading: "オープンエーアイ", accent_type: 0 },
            {
              surface: "ＯｐｅｎＡＩ",
              reading: "オープンエーアイ",
              accent_type: 0,
            },
            { surface: "Absent", reading: "アブセント", accent_type: 0 },
            { surface: "GPT-5", reading: "latin", accent_type: 0 },
          ],
        })
      ),
    })

    const terms = await Effect.runPromise(
      extractor.extract({ script: "OpenAIのニュースを紹介します。" })
    )

    expect(terms).toEqual([
      { surface: "OpenAI", reading: "オープンエーアイ", accentType: 0 },
    ])
    expect(Object.isFrozen(terms)).toBe(true)
  })

  it("classifies schema-invalid output before persistence", async () => {
    const extractor = makeOpenAiReadingTermExtractor(config, {
      languageModelLayer: makeFakeLanguageModelLayer(() =>
        Effect.succeed({ terms: "not-an-array" })
      ),
    })

    const failure = await Effect.runPromise(
      Effect.flip(extractor.extract({ script: "台本" }))
    )

    expect(failure).toEqual({ _tag: "MalformedResponse" })
  })
})
