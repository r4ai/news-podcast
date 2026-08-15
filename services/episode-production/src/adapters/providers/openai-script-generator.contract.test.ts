import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { makeOpenAiScriptGenerator } from "./openai-script-generator.js"

const live = process.env.PROVIDER_CONTRACT_REFRESH === "1"
const requestedSamples = Number.parseInt(
  process.env.OPENAI_CONTRACT_SAMPLES ?? "3",
  10
)
const samples = Number.isSafeInteger(requestedSamples)
  ? Math.min(25, Math.max(1, requestedSamples))
  : 3

describe.runIf(live)("OpenAI script generator live contract", () => {
  it("accepts repeated gpt-5.6-luna Responses structured outputs", async () => {
    const apiKey = process.env.OPENAI_API_KEY?.trim()
    const model = process.env.OPENAI_MODEL?.trim()
    if (!apiKey || !model)
      throw new Error("OpenAI contract configuration missing")

    const observations: Array<{
      readonly httpStatus: number
      readonly contentType: string | null
      readonly status: unknown
      readonly outputTypes: readonly unknown[]
      readonly contentTypes: readonly unknown[]
      readonly usage: unknown
    }> = []
    const fetcher: typeof fetch = async (input, init) => {
      const response = await fetch(input, init)
      const value = (await response.clone().json()) as Record<string, unknown>
      const output = Array.isArray(value.output) ? value.output : []
      observations.push({
        httpStatus: response.status,
        contentType: response.headers.get("content-type"),
        status: value.status,
        outputTypes: output.map((item) =>
          typeof item === "object" && item !== null
            ? (item as Record<string, unknown>).type
            : undefined
        ),
        contentTypes: output.flatMap((item) => {
          if (typeof item !== "object" || item === null) return []
          const content = (item as Record<string, unknown>).content
          return Array.isArray(content)
            ? content.map((part) =>
                typeof part === "object" && part !== null
                  ? (part as Record<string, unknown>).type
                  : undefined
              )
            : []
        }),
        usage: value.usage,
      })
      return response
    }
    const generator = makeOpenAiScriptGenerator(
      {
        endpoint: new URL(
          process.env.OPENAI_RESPONSES_URL?.trim() ||
            "https://api.openai.com/v1/responses"
        ),
        apiKey,
        model,
        requestTimeoutMillis: 120_000,
        retryPolicy: {
          maximumAttempts: 1,
          maximumElapsedMillis: 120_000,
          baseDelayMillis: 0,
          maximumDelayMillis: 0,
        },
      },
      { fetcher }
    )

    for (let index = 0; index < samples; index += 1) {
      const sourceUrl = `https://example.test/article-${index}`
      const output = await Effect.runPromise(
        generator.generate({
          sources: [
            {
              title: `匿名化した契約確認 ${index}`,
              url: sourceUrl,
              markdown: `TypeScriptの外部境界契約を検証する短い記事 ${index}`,
            },
          ],
        })
      )
      expect(output.title.length).toBeGreaterThan(0)
      expect(output.script.length).toBeGreaterThan(0)
      expect(output.sourceUrls).toEqual([sourceUrl])
    }

    expect(observations).toHaveLength(samples)
    for (const observation of observations) {
      expect(observation.httpStatus).toBe(200)
      expect(observation.contentType).toMatch(/^application\/json\b/i)
      expect(observation.status).toBe("completed")
      expect(observation.outputTypes).toContain("message")
      expect(observation.contentTypes).toEqual(["output_text"])
      expect(observation.usage).toMatchObject({
        input_tokens: expect.any(Number),
        output_tokens: expect.any(Number),
      })
    }
  }, 180_000)
})
