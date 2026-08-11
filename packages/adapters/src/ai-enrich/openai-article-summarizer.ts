import { z } from "zod"

import type {
  ArticleSummarizer,
  ArticleSummaryInput,
  ArticleSummaryResult,
} from "@news-podcast/application"

import type { OpenAiConfig } from "../config.js"
import {
  DEFAULT_RETRY_OPTIONS,
  fetchWithRetry,
  ProviderRateLimitError,
  type RetryOptions,
  SUMMARY_MAX_MARKDOWN_CHARS,
  SUMMARY_SCHEMA_NAME,
} from "./shared.js"

interface OpenAiUsage {
  readonly input_tokens?: unknown
  readonly output_tokens?: unknown
}

const OPENAI_REQUEST_TIMEOUT_MS = 120_000

interface OpenAiResponse {
  readonly output?: readonly {
    readonly content?: readonly {
      readonly type?: unknown
      readonly text?: unknown
    }[]
  }[]
  readonly usage?: OpenAiUsage
}

const SummaryPayload = z.object({
  summary: z.string().min(1),
})

export class ArticleSummaryError extends Error {
  constructor(
    message: string,
    readonly retryable = true
  ) {
    super(message)
    this.name = "ArticleSummaryError"
  }
}

export class OpenAiArticleSummarizer implements ArticleSummarizer {
  constructor(
    private readonly config: OpenAiConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly retry: RetryOptions = DEFAULT_RETRY_OPTIONS
  ) {}

  async summarize(
    input: ArticleSummaryInput,
    signal?: AbortSignal
  ): Promise<ArticleSummaryResult> {
    const markdown = input.markdown.slice(0, SUMMARY_MAX_MARKDOWN_CHARS)
    let response: Response
    try {
      response = await fetchWithRetry(
        this.fetcher,
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: boundedSignal(signal),
          body: JSON.stringify({
            model: this.config.model,
            input: [
              {
                role: "system",
                content:
                  "与えられた記事のタイトルと本文Markdownだけを根拠に、日本語のMarkdown要約を約300字で作成してください。英語の記事でも必ず日本語で要約してください。冒頭に記事が一番伝えたい結論・要点を簡潔に書き、その下にポイントを直感的に伝えるMermaidのフローチャートや、具体例・結果・表などを簡潔に添えてください。Mermaidは```mermaidのコードブロックで囲ってください。体言止め（名詞で文を終える）で書き、文末に「。」は付けないでください。根拠のない事実は追加しないでください。",
              },
              {
                role: "user",
                content: JSON.stringify({
                  title: input.title,
                  markdown,
                }),
              },
            ],
            text: {
              format: {
                type: "json_schema",
                name: SUMMARY_SCHEMA_NAME,
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["summary"],
                  properties: {
                    summary: { type: "string" },
                  },
                },
              },
            },
          }),
        },
        this.retry
      )
    } catch (error) {
      throw new ArticleSummaryError(`OpenAI request failed: ${error}`)
    }

    if (response.status === 429) {
      throw new ProviderRateLimitError()
    }
    if (!response.ok) {
      let detail = ""
      try {
        const errorBody = (await response.json()) as Record<string, unknown>
        detail = `: ${JSON.stringify(errorBody)}`
      } catch {
        // keep detail empty
      }
      throw new ArticleSummaryError(
        `OpenAI request failed with ${response.status}${detail}`
      )
    }

    const providerResponse = (await response.json()) as OpenAiResponse
    const outputText = providerResponse.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text
    if (typeof outputText !== "string") {
      throw new ArticleSummaryError(
        "OpenAI response did not contain output_text",
        false
      )
    }

    return {
      markdown: parseSummaryPayload(outputText).summary,
      ...readUsage(providerResponse.usage),
    }
  }
}

function boundedSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS)
  return parent ? AbortSignal.any([parent, timeout]) : timeout
}

function parseSummaryPayload(outputText: string): {
  summary: string
} {
  let raw: unknown
  try {
    raw = JSON.parse(outputText)
  } catch {
    throw new ArticleSummaryError("OpenAI response was not valid JSON", false)
  }
  const parsed = SummaryPayload.safeParse(raw)
  if (!parsed.success) {
    throw new ArticleSummaryError(
      "OpenAI response did not match the summary schema",
      false
    )
  }
  return { summary: parsed.data.summary }
}

function readUsage(usage: OpenAiUsage | undefined): {
  tokensIn: number
  tokensOut: number
} {
  return {
    tokensIn: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
    tokensOut:
      typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
  }
}
