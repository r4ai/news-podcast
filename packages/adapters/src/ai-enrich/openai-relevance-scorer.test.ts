import { describe, expect, it, vi } from "vitest"

import {
  OpenAiRelevanceScorer,
  RelevanceScoreError,
} from "./openai-relevance-scorer.js"
import { DEFAULT_RETRY_OPTIONS, ProviderRateLimitError } from "./shared.js"

const noSleepRetry = {
  ...DEFAULT_RETRY_OPTIONS,
  sleep: () => Promise.resolve(),
}

function jsonSchemaResponse(scores: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({ scores }) }],
        },
      ],
      usage: { input_tokens: 300, output_tokens: 90 },
    }),
    { status: 200 }
  )
}

const candidates = [
  { feedItemId: "a", title: "記事A", bullets: ["1", "2", "3"] },
  { feedItemId: "b", title: "記事B", bullets: ["1", "2", "3"] },
]

describe("OpenAiRelevanceScorer", () => {
  it("scores every candidate in a single batched call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonSchemaResponse([
        { feed_item_id: "a", score: 80, reason: "興味に合致" },
        { feed_item_id: "b", score: 10, reason: "除外対象に近い" },
      ])
    )
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    const result = await scorer.score({
      profile: { include: "AI", exclude: "野球" },
      candidates,
      tagVocabulary: [],
    })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(result.scores).toEqual([
      {
        feedItemId: "a",
        score: 80,
        reason: "興味に合致",
        tags: [],
        suggestedTags: [],
      },
      {
        feedItemId: "b",
        score: 10,
        reason: "除外対象に近い",
        tags: [],
        suggestedTags: [],
      },
    ])
    expect(result.tokensIn).toBe(300)
    expect(result.tokensOut).toBe(90)
  })

  it("filters out scores for feed_item_ids that were not in the request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonSchemaResponse([
        { feed_item_id: "a", score: 80, reason: "ok" },
        { feed_item_id: "unknown-id", score: 5, reason: "invented" },
      ])
    )
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    const result = await scorer.score({
      profile: { include: "AI", exclude: "" },
      candidates,
      tagVocabulary: [],
    })

    expect(result.scores.map((score) => score.feedItemId)).toEqual(["a"])
  })

  it("passes the tag vocabulary as an enum and maps tags/suggested_tags", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonSchemaResponse([
        {
          feed_item_id: "a",
          score: 80,
          reason: "興味に合致",
          tags: ["AI"],
          suggested_tags: ["新しいタグ"],
        },
      ])
    )
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    const result = await scorer.score({
      profile: { include: "AI", exclude: "" },
      candidates: [candidates[0]!],
      tagVocabulary: ["AI", "野球"],
    })

    expect(result.scores).toEqual([
      {
        feedItemId: "a",
        score: 80,
        reason: "興味に合致",
        tags: ["AI"],
        suggestedTags: ["新しいタグ"],
      },
    ])
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(
      body.text.format.schema.properties.scores.items.properties.tags.items.enum
    ).toEqual(["AI", "野球"])
  })

  it("filters out tags/suggested tags that leak outside the vocabulary boundary", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonSchemaResponse([
        {
          feed_item_id: "a",
          score: 80,
          reason: "興味に合致",
          // enumで縛られていても、防御的に語彙外は落とす。
          tags: ["AI", "語彙外"],
          suggested_tags: ["AI"],
        },
      ])
    )
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    const result = await scorer.score({
      profile: { include: "AI", exclude: "" },
      candidates: [candidates[0]!],
      tagVocabulary: ["AI"],
    })

    expect(result.scores[0]?.tags).toEqual(["AI"])
    expect(result.scores[0]?.suggestedTags).toEqual([])
  })

  it("omits tag fields from the schema and skips tagging when the vocabulary is empty", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonSchemaResponse([{ feed_item_id: "a", score: 80, reason: "ok" }])
      )
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    const result = await scorer.score({
      profile: { include: "", exclude: "" },
      candidates: [candidates[0]!],
      tagVocabulary: [],
    })

    expect(result.scores[0]?.tags).toEqual([])
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(
      body.text.format.schema.properties.scores.items.properties.tags
    ).toBeUndefined()
  })

  it("rejects a response that violates the score range schema", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonSchemaResponse([
          { feed_item_id: "a", score: 500, reason: "out of range" },
        ])
      )
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    await expect(
      scorer.score({
        profile: { include: "", exclude: "" },
        candidates,
        tagVocabulary: [],
      })
    ).rejects.toBeInstanceOf(RelevanceScoreError)
  })

  it("throws ProviderRateLimitError once 429 retries are exhausted", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }))
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      { ...noSleepRetry, maxAttempts: 2 }
    )

    await expect(
      scorer.score({
        profile: { include: "", exclude: "" },
        candidates,
        tagVocabulary: [],
      })
    ).rejects.toBeInstanceOf(ProviderRateLimitError)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
