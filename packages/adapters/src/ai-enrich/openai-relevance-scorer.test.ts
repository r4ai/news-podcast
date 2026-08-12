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
  { feedItemId: "a", title: "記事A", summary: "要約A" },
  { feedItemId: "b", title: "記事B", summary: "要約B" },
]

describe("OpenAiRelevanceScorer", () => {
  it("scores every candidate in a single batched call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonSchemaResponse([
        { feed_item_id: "a", score: 80, reason: "includeに合致するから" },
        { feed_item_id: "b", score: 10, reason: "excludeに合致するから" },
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
        reason: "includeに合致するから",
        tags: [],
        suggestedTags: [],
      },
      {
        feedItemId: "b",
        score: 10,
        reason: "excludeに合致するから",
        tags: [],
        suggestedTags: [],
      },
    ])
    expect(result.tokensIn).toBe(300)
    expect(result.tokensOut).toBe(90)
  })

  it("omits model-specific sampling parameters and instructs the reason to end with から", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonSchemaResponse([
          { feed_item_id: "a", score: 50, reason: "中立だから" },
        ])
      )
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    await scorer.score({
      profile: { include: "AI", exclude: "" },
      candidates: [candidates[0]!],
      tagVocabulary: [],
    })

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body).not.toHaveProperty("temperature")
    const systemContent = body.input[0].content as string
    expect(systemContent).toContain("〜から」で終わらせて")
    expect(systemContent).toContain("80-100")
    const articles = JSON.parse(body.input[1].content).articles as unknown[]
    expect(articles[0]).toEqual({
      feed_item_id: "a",
      title: "記事A",
      summary: "要約A",
    })
  })

  it.each([
    {
      name: "an unknown id",
      scores: [
        { feed_item_id: "a", score: 80, reason: "ok" },
        { feed_item_id: "unknown-id", score: 5, reason: "invented" },
      ],
    },
    {
      name: "a missing id",
      scores: [{ feed_item_id: "a", score: 80, reason: "ok" }],
    },
    {
      name: "a duplicate id",
      scores: [
        { feed_item_id: "a", score: 80, reason: "ok" },
        { feed_item_id: "a", score: 70, reason: "duplicate" },
      ],
    },
  ])("rejects a response with $name", async ({ scores }) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonSchemaResponse(scores)
    )
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    await expect(
      scorer.score({
        profile: { include: "AI", exclude: "" },
        candidates,
        tagVocabulary: [],
      })
    ).rejects.toThrow("exactly once")
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

  it("preserves the OpenAI error detail for an invalid request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            message:
              "Unsupported parameter: 'temperature' is not supported with this model.",
            param: "temperature",
          },
        },
        { status: 400 }
      )
    )
    const scorer = new OpenAiRelevanceScorer(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher,
      noSleepRetry
    )

    const error = await scorer
      .score({
        profile: { include: "", exclude: "" },
        candidates,
        tagVocabulary: [],
      })
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(RelevanceScoreError)
    expect(error).toMatchObject({ retryable: false })
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining(
        "Unsupported parameter: 'temperature' is not supported with this model."
      )
    )
  })
})
