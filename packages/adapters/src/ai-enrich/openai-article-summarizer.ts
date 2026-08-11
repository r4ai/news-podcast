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
  bullets: z.array(z.string().min(1)).length(3),
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
                  "与えられた記事のタイトルと本文Markdownだけを根拠に、日本語で3点の箇条書き要約を作成してください。英語の記事でも必ず日本語で要約してください。各箇条書きは1文、根拠のない事実を追加しないでください。",
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
                name: "article_summary",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["bullets"],
                  properties: {
                    bullets: {
                      type: "array",
                      minItems: 3,
                      maxItems: 3,
                      items: { type: "string" },
                    },
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
      throw new ArticleSummaryError(
        `OpenAI request failed with ${response.status}`
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
      bullets: parseSummaryPayload(outputText).bullets,
      ...readUsage(providerResponse.usage),
    }
  }
}

function boundedSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS)
  return parent ? AbortSignal.any([parent, timeout]) : timeout
}

function parseSummaryPayload(outputText: string): {
  bullets: readonly string[]
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
  return { bullets: parsed.data.bullets }
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
