import { z } from "zod"

import type {
  ArticleRelevanceScorer,
  InterestProfile,
  RelevanceBatchResult,
  RelevanceCandidate,
} from "@news-podcast/application"

import type { OpenAiConfig } from "../config.js"
import {
  createPortableStructuredResponseRequest,
  hasOpenAiRefusal,
  isRetryableOpenAiStatus,
  readOpenAiErrorMessage,
} from "./openai-responses.js"
import {
  DEFAULT_RETRY_OPTIONS,
  fetchWithRetry,
  ProviderRateLimitError,
  RELEVANCE_SCHEMA_NAME,
  type RetryOptions,
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

const ScorePayload = z.object({
  scores: z.array(
    z.object({
      feed_item_id: z.string().min(1),
      score: z.number().int().min(0).max(100),
      reason: z.string().min(1),
      // tagVocabularyが空のときはスキーマから外れるため未定義になり得る。
      tags: z.array(z.string()).optional(),
      suggested_tags: z.array(z.string()).optional(),
    })
  ),
})

type RelevanceScoreInput = {
  readonly profile: InterestProfile
  readonly candidates: readonly RelevanceCandidate[]
  readonly tagVocabulary: readonly string[]
}

const MAX_RESPONSE_ATTEMPTS = 2

export class RelevanceScoreError extends Error {
  constructor(
    message: string,
    readonly retryable = true
  ) {
    super(message)
    this.name = "RelevanceScoreError"
  }
}

export class OpenAiRelevanceScorer implements ArticleRelevanceScorer {
  constructor(
    private readonly config: OpenAiConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly retry: RetryOptions = DEFAULT_RETRY_OPTIONS
  ) {}

  async score(
    input: RelevanceScoreInput,
    signal?: AbortSignal
  ): Promise<RelevanceBatchResult> {
    if (input.candidates.length === 0) {
      throw new RelevanceScoreError("At least one candidate is required", false)
    }

    for (let attempt = 0; attempt < MAX_RESPONSE_ATTEMPTS; attempt += 1) {
      try {
        return await this.scoreOnce(input, signal)
      } catch (error) {
        if (
          !(error instanceof RelevanceScoreError) ||
          !error.retryable ||
          attempt === MAX_RESPONSE_ATTEMPTS - 1
        ) {
          throw error
        }
      }
    }
    throw new RelevanceScoreError("OpenAI response retry limit exceeded")
  }

  private async scoreOnce(
    input: RelevanceScoreInput,
    signal?: AbortSignal
  ): Promise<RelevanceBatchResult> {

    // タグ付与はスコア付けと同じ1コールに相乗りさせる（コール数を増やさない）。
    // 語彙が空ならenumが空になり構造化出力が壊れるため、tags関連フィールド自体を
    // スキーマから外してタグ付与をスキップする。
    const hasVocabulary = input.tagVocabulary.length > 0

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
                  content: hasVocabulary
                    ? "利用者の興味プロフィール（含めたい話題include、除きたい話題exclude）と、記事のタイトル・要約の一覧を渡します。各記事について0から100の適合度スコアと、日本語1行の理由を付けてください。excludeに合致する記事は低いスコアにしてください。理由は簡潔に1文で書き、「〜から」で終わらせてください（「〜ため」で終わらせないこと）。安定したスコア付けのために以下の基準を厳守してください：基準1＝includeのキーワードと意味的に一致する話題なら80-100、基準2＝includeに部分的・間接的に関連するなら50-79、基準3＝どちらでもなく中立なら30-49、基準4＝includeと無関係かexcludeに合致するなら0-29。入力に無いfeed_item_idを作らないでください。さらに、渡されたtag_vocabularyの中からその記事に合うタグを0件以上選んでtagsに入れてください（tag_vocabularyに無い語を作らないこと）。tag_vocabularyに無いが付けたいタグがあればsuggested_tagsに入れてください。"
                    : "利用者の興味プロフィール（含めたい話題include、除きたい話題exclude）と、記事のタイトル・要約の一覧を渡します。各記事について0から100の適合度スコアと、日本語1行の理由を付けてください。excludeに合致する記事は低いスコアにしてください。理由は簡潔に1文で書き、「〜から」で終わらせてください（「〜ため」で終わらせないこと）。安定したスコア付けのために以下の基準を厳守してください：基準1＝includeのキーワードと意味的に一致する話題なら80-100、基準2＝includeに部分的・間接的に関連するなら50-79、基準3＝どちらでもなく中立なら30-49、基準4＝includeと無関係かexcludeに合致するなら0-29。入力に無いfeed_item_idを作らないでください。",
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    profile: input.profile,
                    ...(hasVocabulary
                      ? { tag_vocabulary: input.tagVocabulary }
                      : {}),
                    articles: input.candidates.map((candidate) => ({
                      feed_item_id: candidate.feedItemId,
                      title: candidate.title,
                      summary: candidate.summary,
                    })),
                  }),
                },
              ],
              text: {
                format: {
                  type: "json_schema",
                  name: RELEVANCE_SCHEMA_NAME,
                  strict: true,
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["scores"],
                    properties: {
                      scores: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: hasVocabulary
                            ? [
                                "feed_item_id",
                                "score",
                                "reason",
                                "tags",
                                "suggested_tags",
                              ]
                            : ["feed_item_id", "score", "reason"],
                          properties: {
                            feed_item_id: { type: "string" },
                            score: {
                              type: "integer",
                              minimum: 0,
                              maximum: 100,
                            },
                            reason: { type: "string" },
                            ...(hasVocabulary
                              ? {
                                  tags: {
                                    type: "array",
                                    items: {
                                      type: "string",
                                      enum: [...input.tagVocabulary],
                                    },
                                  },
                                  suggested_tags: {
                                    type: "array",
                                    items: { type: "string" },
                                  },
                                }
                              : {}),
                          },
                        },
                      },
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
      throw new RelevanceScoreError(`OpenAI request failed: ${error}`)
    }

    if (response.status === 429) {
      throw new ProviderRateLimitError()
    }
    if (!response.ok) {
      const detail = await readOpenAiErrorMessage(response)
      throw new RelevanceScoreError(
        `OpenAI request failed with ${response.status}${detail ? `: ${detail}` : ""}`,
        isRetryableOpenAiStatus(response.status)
      )
    }

    let providerResponse: OpenAiResponse
    try {
      providerResponse = (await response.json()) as OpenAiResponse
    } catch {
      throw new RelevanceScoreError(
        "OpenAI response body was not valid JSON"
      )
    }
    const outputText = providerResponse.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text
    if (typeof outputText !== "string") {
      if (hasOpenAiRefusal(providerResponse.output)) {
        throw new RelevanceScoreError(
          "OpenAI refused relevance output",
          false
        )
      }
      throw new RelevanceScoreError(
        "OpenAI response did not contain output_text"
      )
    }

    const scores = parseScorePayload(
      outputText,
      input.candidates,
      input.tagVocabulary
    )
    return { scores, ...readUsage(providerResponse.usage) }
  }
}

function boundedSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS)
  return parent ? AbortSignal.any([parent, timeout]) : timeout
}

function parseScorePayload(
  outputText: string,
  candidates: readonly RelevanceCandidate[],
  tagVocabulary: readonly string[]
) {
  let raw: unknown
  try {
    raw = JSON.parse(outputText)
  } catch {
    throw new RelevanceScoreError("OpenAI response was not valid JSON")
  }
  const parsed = ScorePayload.safeParse(raw)
  if (!parsed.success) {
    throw new RelevanceScoreError(
      "OpenAI response did not match the relevance schema"
    )
  }
  const allowed = new Set(candidates.map((candidate) => candidate.feedItemId))
  const occurrences = new Map<string, number>()
  for (const score of parsed.data.scores) {
    occurrences.set(
      score.feed_item_id,
      (occurrences.get(score.feed_item_id) ?? 0) + 1
    )
  }
  const completeOneToOneMapping =
    parsed.data.scores.length === candidates.length &&
    parsed.data.scores.every((score) => allowed.has(score.feed_item_id)) &&
    candidates.every(
      (candidate) => occurrences.get(candidate.feedItemId) === 1
    )
  if (!completeOneToOneMapping) {
    throw new RelevanceScoreError(
      "OpenAI response must score every requested feed_item_id exactly once"
    )
  }
  const scores = parsed.data.scores
  const vocabulary = new Set(tagVocabulary)
  return scores.map((score) => ({
    feedItemId: score.feed_item_id,
    score: score.score,
    reason: score.reason,
    // enumで縛っていても、二重に語彙外混入を防ぐ（防御的フィルタ）。
    tags: (score.tags ?? []).filter((tag) => vocabulary.has(tag)),
    suggestedTags: (score.suggested_tags ?? []).filter(
      (tag) => !vocabulary.has(tag)
    ),
  }))
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
