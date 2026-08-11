import { describe, expect, it, vi } from "vitest"

import { OpenAiSummaryGenerator } from "./openai-summary-generator.js"

const item = {
  sourceName: "Example Feed",
  title: "Example",
  url: new URL("https://example.com/article"),
  description: "RSS description",
}

describe("OpenAiSummaryGenerator", () => {
  it("returns only source URLs from the supplied RSS items", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: "技術ニュース",
                    script: "確認できる事実だけの台本",
                    source_urls: [item.url.href],
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    )
    const generator = new OpenAiSummaryGenerator(
      { apiKey: "test-key", model: "gpt-5.6-luna" },
      fetcher
    )

    await expect(generator.generate([item])).resolves.toEqual({
      title: "技術ニュース",
      script: "確認できる事実だけの台本",
      sourceUrls: [item.url],
    })
    expect(fetcher).toHaveBeenCalledOnce()
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(request.text.format.schema.properties.source_urls.items).toEqual({
      type: "string",
    })
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it("rejects provider-invented source URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: "title",
                    script: "script",
                    source_urls: ["https://invented.example/news"],
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    )

    await expect(
      new OpenAiSummaryGenerator(
        { apiKey: "test-key", model: "gpt-5.6-luna" },
        fetcher
      ).generate([item])
    ).rejects.toThrow("OpenAI response referenced an unknown source URL")
  })
})
