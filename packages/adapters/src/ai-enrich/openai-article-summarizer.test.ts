import { describe, expect, it, vi } from "vitest"

import {
  ArticleSummaryError,
  OpenAiArticleSummarizer,
} from "./openai-article-summarizer.js"
import { DEFAULT_RETRY_OPTIONS, ProviderRateLimitError } from "./shared.js"

const noSleepRetry = { ...DEFAULT_RETRY_OPTIONS, sleep: () => Promise.resolve() }

function jsonSchemaResponse(bullets: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: JSON.stringify({ bullets }) },
          ],
        },
      ],
      usage: { input_tokens: 120, output_tokens: 40 },
    }),
    { status: 200 }
  )
}

describe("OpenAiArticleSummarizer", () => {
  it("returns 3 Japanese bullets and token usage on a valid structured response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonSchemaResponse(["要点1", "要点2", "要点3"])
      )
    const summarizer = new OpenAiArticleSummarizer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    await expect(
      summarizer.summarize({ title: "タイトル", markdown: "本文" })
    ).resolves.toEqual({
      bullets: ["要点1", "要点2", "要点3"],
      tokensIn: 120,
      tokensOut: 40,
    })
  })

  it("truncates markdown to the configured max length before sending", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonSchemaResponse(["a", "b", "c"]))
    const summarizer = new OpenAiArticleSummarizer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )
    const longMarkdown = "x".repeat(10_000)

    await summarizer.summarize({ title: "t", markdown: longMarkdown })

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    const sentMarkdown = JSON.parse(body.input[1].content).markdown as string
    expect(sentMarkdown.length).toBeLessThan(10_000)
  })

  it("rejects a response that violates the summary schema (not exactly 3 bullets)", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonSchemaResponse(["only-one"]))
    const summarizer = new OpenAiArticleSummarizer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    await expect(
      summarizer.summarize({ title: "t", markdown: "m" })
    ).rejects.toBeInstanceOf(ArticleSummaryError)
  })

  it("throws ProviderRateLimitError once 429 retries are exhausted", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }))
    const summarizer = new OpenAiArticleSummarizer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      { ...noSleepRetry, maxAttempts: 2 }
    )

    await expect(
      summarizer.summarize({ title: "t", markdown: "m" })
    ).rejects.toBeInstanceOf(ProviderRateLimitError)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
