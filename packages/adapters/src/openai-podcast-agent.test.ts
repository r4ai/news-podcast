import { describe, expect, it, vi } from "vitest"

import { OpenAiPodcastAgent } from "./openai-podcast-agent.js"

describe("OpenAiPodcastAgent", () => {
  it("lets the model list and read archived RSS articles before submitting", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "response-1",
          output: [
            {
              type: "function_call",
              name: "list_rss_articles",
              arguments: '{"limit":10}',
              call_id: "call-1",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "response-2",
          output: [
            {
              type: "function_call",
              name: "read_article",
              arguments:
                '{"article_id":"00000000-0000-4000-8000-000000000010"}',
              call_id: "call-2",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "response-3",
          output: [
            {
              type: "function_call",
              name: "submit_episode_draft",
              arguments: JSON.stringify({
                title: "今日のニュース",
                script: "記事本文を根拠にしたニュースです。".repeat(10),
                source_urls: ["https://example.com/article"],
              }),
              call_id: "call-3",
            },
          ],
        })
      ) as unknown as typeof fetch
    const audit = {
      start: vi.fn(() => "run-1"),
      tool: vi.fn(),
      finish: vi.fn(),
    }
    const article = {
      id: "00000000-0000-4000-8000-000000000010",
      snapshotId: "00000000-0000-4000-8000-000000000011",
      feedId: "00000000-0000-4000-8000-000000000012",
      sourceName: "Example",
      title: "記事",
      url: new URL("https://example.com/article"),
    }
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      {
        listArticles: vi.fn(() => Promise.resolve([article])),
        readArticle: vi.fn(() =>
          Promise.resolve({ article, markdown: "# 記事\n本文" })
        ),
      },
      audit,
      fetcher
    )

    await expect(
      agent.run({
        jobId: "00000000-0000-4000-8000-000000000001",
        ownerId: "owner",
        feedIds: [article.feedId],
      })
    ).resolves.toMatchObject({
      title: "今日のニュース",
      sourceUrls: [new URL("https://example.com/article")],
    })
    expect(audit.tool).toHaveBeenCalledTimes(3)
    expect(audit.finish).toHaveBeenCalledWith("run-1")
  })
})
