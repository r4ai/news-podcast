import type {
  EpisodeScriptDraft,
  RssSourceItem,
  SummaryGenerator,
} from "@news-podcast/application"

import type { OpenAiConfig } from "./config.js"

interface OpenAiResponse {
  readonly output_text?: unknown
}

interface ScriptPayload {
  readonly title: unknown
  readonly script: unknown
  readonly source_urls: unknown
}

export class SummaryProviderError extends Error {
  constructor(message: string) {
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

    const response = await this.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        input: [
          {
            role: "system",
            content:
              "Write a factual Japanese podcast script using only the supplied RSS item data. Do not add ungrounded facts.",
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
                  items: { type: "string", format: "uri" },
                },
              },
            },
          },
        },
      }),
    })

    if (!response.ok) {
      throw new SummaryProviderError(
        `OpenAI request failed with ${response.status}`
      )
    }

    const providerResponse = (await response.json()) as OpenAiResponse
    if (typeof providerResponse.output_text !== "string") {
      throw new SummaryProviderError(
        "OpenAI response did not contain output_text"
      )
    }

    return parseScriptPayload(providerResponse.output_text, items)
  }
}

function parseScriptPayload(
  outputText: string,
  inputs: readonly RssSourceItem[]
): EpisodeScriptDraft {
  let payload: ScriptPayload
  try {
    payload = JSON.parse(outputText) as ScriptPayload
  } catch {
    throw new SummaryProviderError("OpenAI response was not valid JSON")
  }

  if (
    typeof payload.title !== "string" ||
    typeof payload.script !== "string" ||
    !Array.isArray(payload.source_urls) ||
    !payload.source_urls.every((value) => typeof value === "string")
  ) {
    throw new SummaryProviderError(
      "OpenAI response did not match the script schema"
    )
  }

  const allowed = new Set(inputs.map((item) => item.url.href))
  const sourceUrls = payload.source_urls.map(
    (value) => new URL(value as string)
  )
  if (sourceUrls.some((url) => !allowed.has(url.href))) {
    throw new SummaryProviderError(
      "OpenAI response referenced an unknown source URL"
    )
  }

  return { title: payload.title, script: payload.script, sourceUrls }
}
