import { z } from "zod"
import mermaid from "mermaid"

import type {
  ArticleSummarizer,
  ArticleSummaryInput,
  ArticleSummaryResult,
} from "@news-podcast/application"

import type { OpenAiConfig } from "../config.js"
import {
  createPortableStructuredResponseRequest,
  isRetryableOpenAiStatus,
  readOpenAiErrorMessage,
} from "./openai-responses.js"
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
const MAX_SUMMARY_ATTEMPTS = 2

const SUMMARY_INSTRUCTIONS =
  "与えられた記事のタイトルと本文Markdownだけを根拠に、日本語のMarkdown要約を約300字で作成してください。英語の記事でも必ず日本語で要約してください。記事が一番伝えたい結論・要点から書き始め、ポイントを直感的に伝えるMermaidのフローチャートや、具体例・結果・表などを簡潔に添えてください。Mermaidは```mermaidのコードブロックで囲ってください。Markdown見出しや「要点：」「結論：」「概要：」「まとめ：」などの見出しラベルは一切使わず、フラットな文章にしてください。体言止め（名詞で文を終える）で書き、文末に「。」は付けないでください。根拠のない事実は追加しないでください。"

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
    let invalidSummary: string | undefined
    let tokensIn = 0
    let tokensOut = 0

    for (let attempt = 0; attempt < MAX_SUMMARY_ATTEMPTS; attempt += 1) {
      const result = await this.requestSummary(
        input.title,
        markdown,
        invalidSummary,
        signal
      )
      tokensIn += result.tokensIn
      tokensOut += result.tokensOut
      const summary = flattenSummaryHeadings(result.summary)
      const inspected = await inspectMermaid(summary)
      if (inspected.valid) {
        return { markdown: summary, tokensIn, tokensOut }
      }
      if (
        attempt === MAX_SUMMARY_ATTEMPTS - 1 &&
        inspected.markdownWithoutInvalid.length > 0
      ) {
        return {
          markdown: inspected.markdownWithoutInvalid,
          tokensIn,
          tokensOut,
          warnings: ["invalid-mermaid-removed"],
        }
      }
      invalidSummary = summary
    }

    throw new ArticleSummaryError(
      "OpenAI response contained no usable summary after Mermaid removal",
      false
    )
  }

  private async requestSummary(
    title: string,
    markdown: string,
    invalidSummary: string | undefined,
    signal?: AbortSignal
  ): Promise<{ summary: string; tokensIn: number; tokensOut: number }> {
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
          body: JSON.stringify(
            createPortableStructuredResponseRequest({
              model: this.config.model,
              input: [
                {
                  role: "system",
                  content: invalidSummary
                    ? `${SUMMARY_INSTRUCTIONS} 前回の要約に構文エラーのあるMermaidが含まれていました。内容を変えずにMermaid構文だけを修正し、要約全体を返してください。`
                    : SUMMARY_INSTRUCTIONS,
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    title,
                    markdown,
                    ...(invalidSummary ? { invalidSummary } : {}),
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
            })
          ),
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
      const detail = await readOpenAiErrorMessage(response)
      throw new ArticleSummaryError(
        `OpenAI request failed with ${response.status}${detail ? `: ${detail}` : ""}`,
        isRetryableOpenAiStatus(response.status)
      )
    }

    const providerResponse = (await response.json()) as OpenAiResponse
    const outputText = providerResponse.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text
    if (typeof outputText !== "string") {
      throw new ArticleSummaryError(
        "OpenAI response did not contain output_text"
      )
    }

    return {
      summary: parseSummaryPayload(outputText).summary,
      ...readUsage(providerResponse.usage),
    }
  }
}

/** 生成規約を後処理でも保証し、見出しだけの行は落として本文は保持する。 */
export function flattenSummaryHeadings(summary: string): string {
  return summary
    .split("\n")
    .flatMap((line) => {
      const withoutMarkdownHeading = line.replace(/^#{1,6}\s+/, "")
      if (/^(?:要点|結論|概要|まとめ)[：:]?$/.test(withoutMarkdownHeading)) {
        return []
      }
      return [
        withoutMarkdownHeading.replace(
          /^(?:要点|結論|概要|まとめ)[：:]\s*/,
          ""
        ),
      ]
    })
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
}

async function inspectMermaid(summary: string): Promise<{
  readonly valid: boolean
  readonly markdownWithoutInvalid: string
}> {
  const starts = [...summary.matchAll(/```mermaid\b/gi)]
  const completeDiagrams = [
    ...summary.matchAll(/```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/gi),
  ]
  const completeStarts = new Set(
    completeDiagrams.map((diagram) => diagram.index ?? -1)
  )
  const unclosedStart = starts.find(
    (start) => !completeStarts.has(start.index ?? -1)
  )?.index
  const inspectableSummary =
    unclosedStart === undefined ? summary : summary.slice(0, unclosedStart)
  const diagrams = [
    ...inspectableSummary.matchAll(/```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/gi),
  ]
  let valid = unclosedStart === undefined
  let cursor = 0
  let markdownWithoutInvalid = ""
  for (const diagram of diagrams) {
    const source = diagram[1]?.trim()
    let diagramValid = Boolean(source)
    try {
      diagramValid = Boolean(
        source && (await mermaid.parse(source, { suppressErrors: true }))
      )
    } catch {
      diagramValid = false
    }
    valid &&= diagramValid
    const index = diagram.index ?? cursor
    markdownWithoutInvalid += inspectableSummary.slice(cursor, index)
    if (diagramValid) markdownWithoutInvalid += diagram[0]
    cursor = index + diagram[0].length
  }
  markdownWithoutInvalid += inspectableSummary.slice(cursor)
  return {
    valid,
    markdownWithoutInvalid: markdownWithoutInvalid
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
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
    throw new ArticleSummaryError("OpenAI response was not valid JSON")
  }
  const parsed = SummaryPayload.safeParse(raw)
  if (!parsed.success) {
    throw new ArticleSummaryError(
      "OpenAI response did not match the summary schema"
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
