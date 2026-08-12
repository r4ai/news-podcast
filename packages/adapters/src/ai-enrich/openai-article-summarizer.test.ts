import { describe, expect, it, vi } from "vitest"

import {
  ArticleSummaryError,
  OpenAiArticleSummarizer,
} from "./openai-article-summarizer.js"
import { DEFAULT_RETRY_OPTIONS, ProviderRateLimitError } from "./shared.js"

const noSleepRetry = {
  ...DEFAULT_RETRY_OPTIONS,
  sleep: () => Promise.resolve(),
}

function jsonSchemaResponse(summary: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({ summary }) }],
        },
      ],
      usage: { input_tokens: 120, output_tokens: 40 },
    }),
    { status: 200 }
  )
}

describe("OpenAiArticleSummarizer", () => {
  it("returns a Japanese Markdown summary and token usage on a valid structured response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonSchemaResponse(
          "Suspeiseとuseで実装が簡潔になる\n\n```mermaid\nflowchart LR\na-->b\n```"
        )
      )
    const summarizer = new OpenAiArticleSummarizer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    await expect(
      summarizer.summarize({ title: "タイトル", markdown: "本文" })
    ).resolves.toEqual({
      markdown:
        "Suspeiseとuseで実装が簡潔になる\n\n```mermaid\nflowchart LR\na-->b\n```",
      tokensIn: 120,
      tokensOut: 40,
    })
  })

  it("removes summary headings and heading-like labels from the generated text", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonSchemaResponse(
          "## 要点\n要点：React 19では処理が簡潔になる\n\n### 具体例\nuseを利用する"
        )
      )
    const summarizer = new OpenAiArticleSummarizer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    await expect(
      summarizer.summarize({ title: "タイトル", markdown: "本文" })
    ).resolves.toMatchObject({
      markdown: "React 19では処理が簡潔になる\n\n具体例\nuseを利用する",
    })
  })

  it("repairs invalid Mermaid once and returns only the validated summary", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonSchemaResponse("処理の流れ\n\n```mermaid\nflowchart LR\nA-->\n```")
      )
      .mockResolvedValueOnce(
        jsonSchemaResponse("処理の流れ\n\n```mermaid\nflowchart LR\nA-->B\n```")
      )
    const summarizer = new OpenAiArticleSummarizer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    await expect(
      summarizer.summarize({ title: "タイトル", markdown: "本文" })
    ).resolves.toMatchObject({
      markdown: "処理の流れ\n\n```mermaid\nflowchart LR\nA-->B\n```",
      tokensIn: 240,
      tokensOut: 80,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    const repairBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))
    expect(repairBody.input[0].content).toContain("Mermaid")
  })

  it("removes invalid Mermaid after one repair attempt and keeps the summary text", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(
          jsonSchemaResponse(
            "処理の流れ\n\n```mermaid\nflowchart LR\nA-->\n```"
          )
        )
      )
    const summarizer = new OpenAiArticleSummarizer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    await expect(
      summarizer.summarize({ title: "タイトル", markdown: "本文" })
    ).resolves.toEqual({
      markdown: "処理の流れ",
      tokensIn: 240,
      tokensOut: 80,
      warnings: ["invalid-mermaid-removed"],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("truncates markdown to the configured max length before sending", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonSchemaResponse("要約です。"))
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

  it("rejects a response that violates the summary schema", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonSchemaResponse({ unexpected: true }))
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
