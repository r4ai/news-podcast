import { describe, expect, it, vi } from "vitest"

import { extractReadingTerms } from "./reading-term-extractor.js"

function response(terms: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ terms }),
            },
          ],
        },
      ],
    }),
    { status: 200 }
  )
}

describe("extractReadingTerms", () => {
  it("uses structured output and keeps valid high-risk pronunciations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response([
        {
          surface: "GPT-5",
          reading: "ジーピーティーファイブ",
          accent_type: 6,
        },
        {
          surface: "Cloudflare",
          reading: "クラウドフレア",
          accent_type: 5,
        },
      ])
    )

    await expect(
      extractReadingTerms(
        "GPT-5とCloudflare Workersについて解説する",
        { apiKey: "test-key", model: "gpt-5.6-luna" },
        new AbortController().signal,
        fetcher
      )
    ).resolves.toEqual([
      {
        surface: "GPT-5",
        reading: "ジーピーティーファイブ",
        accentType: 6,
      },
      {
        surface: "Cloudflare",
        reading: "クラウドフレア",
        accentType: 5,
      },
    ])

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body.text.format.type).toBe("json_schema")
    expect(body.input[0].content).toContain("英略語")
    expect(body.input[0].content).toContain("製品名")
  })

  it("normalizes duplicates and rejects unusable dictionary entries", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response([
        {
          surface: " GPT-5 ",
          reading: "ジーピーティーファイブ",
          accent_type: 6,
        },
        {
          surface: "ＧＰＴ－５",
          reading: "ジーピーティーファイブ",
          accent_type: 6,
        },
        { surface: "empty", reading: "", accent_type: 0 },
        { surface: "english", reading: "english", accent_type: 0 },
        { surface: "invalid", reading: "123", accent_type: -1 },
        {
          surface: "台本にない製品",
          reading: "ダイホンニナイセイヒン",
          accent_type: 4,
        },
      ])
    )

    await expect(
      extractReadingTerms(
        "GPT-5を扱う台本",
        { apiKey: "test-key", model: "gpt-5.6-luna" },
        new AbortController().signal,
        fetcher
      )
    ).resolves.toEqual([
      {
        surface: "GPT-5",
        reading: "ジーピーティーファイブ",
        accentType: 6,
      },
    ])
  })

  it.each([
    {
      name: "a provider error",
      response: new Response(null, { status: 503 }),
      message: "OpenAI request failed with 503",
    },
    {
      name: "an empty output",
      response: Response.json({ status: "completed", output: [] }),
      message: "OpenAI response did not contain output_text",
    },
    {
      name: "malformed structured output",
      response: Response.json({
        output: [{ content: [{ type: "output_text", text: "not-json" }] }],
      }),
      message: "OpenAI response was not valid JSON",
    },
  ])(
    "reports $name instead of silently succeeding",
    async ({ response, message }) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)

      await expect(
        extractReadingTerms(
          "台本",
          { apiKey: "test-key", model: "gpt-5.6-luna" },
          new AbortController().signal,
          fetcher
        )
      ).rejects.toThrow(message)
    }
  )
})
