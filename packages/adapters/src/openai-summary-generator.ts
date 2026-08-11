import type {
  EpisodeScriptDraft,
  RssSourceItem,
  SummaryGenerator,
} from "@news-podcast/application"

import type { OpenAiConfig } from "./config.js"
import { z } from "zod"

const OPENAI_REQUEST_TIMEOUT_MS = 120_000

interface OpenAiResponse {
  readonly output?: readonly {
    readonly content?: readonly {
      readonly type?: unknown
      readonly text?: unknown
    }[]
  }[]
}

const ScriptPayload = z.object({
  title: z.string().min(1),
  script: z.string().min(1),
  source_urls: z.array(z.url()).min(1),
})

export class SummaryProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = true
  ) {
    super(message)
    this.name = "SummaryProviderError"
  }
}

export class OpenAiSummaryGenerator implements SummaryGenerator {
  constructor(
    private readonly config: OpenAiConfig,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async generate(items: readonly RssSourceItem[]): Promise<EpisodeScriptDraft> {
    if (items.length === 0) {
      throw new SummaryProviderError("At least one RSS source item is required")
    }

    let response: Response
    try {
      response = await this.fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model: this.config.model,
          input: [
            {
              role: "system",
              content:
                "RSS項目だけを根拠に、5〜8分の自然な日本語ニュース音声台本を作成してください。各話題で媒体名を短く述べ、根拠のない事実を追加しないでください。source_urlsには実際に使った入力URLだけを返してください。",
            },
            { role: "user", content: JSON.stringify(items) },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "episode_script",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["title", "script", "source_urls"],
                properties: {
                  title: { type: "string" },
                  script: { type: "string" },
                  source_urls: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        }),
      })
    } catch (error) {
      throw new SummaryProviderError(`OpenAI request failed: ${error}`)
    }

    if (!response.ok) {
      throw new SummaryProviderError(
        `OpenAI request failed with ${response.status}`
      )
    }

    const providerResponse = (await response.json()) as OpenAiResponse
    const outputText = providerResponse.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text
    if (typeof outputText !== "string") {
      throw new SummaryProviderError(
        "OpenAI response did not contain output_text",
        false
      )
    }

    return parseScriptPayload(outputText, items)
  }
}

function parseScriptPayload(
  outputText: string,
  inputs: readonly RssSourceItem[]
): EpisodeScriptDraft {
  let raw: unknown
  try {
    raw = JSON.parse(outputText)
  } catch {
    throw new SummaryProviderError("OpenAI response was not valid JSON", false)
  }
  const parsed = ScriptPayload.safeParse(raw)
  if (!parsed.success) {
    throw new SummaryProviderError(
      "OpenAI response did not match the script schema",
      false
    )
  }

  const allowed = new Set(inputs.map((item) => item.url.href))
  const sourceUrls = parsed.data.source_urls.map((value) => new URL(value))
  if (sourceUrls.some((url) => !allowed.has(url.href))) {
    throw new SummaryProviderError(
      "OpenAI response referenced an unknown source URL",
      false
    )
  }

  return {
    title: parsed.data.title,
    script: parsed.data.script,
    sourceUrls,
  }
}
