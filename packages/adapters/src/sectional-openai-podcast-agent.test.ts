import { describe, expect, it, vi } from "vitest"

import { PodcastAgentError, type AgentAudit } from "./openai-podcast-agent.js"
import { SectionalOpenAiPodcastAgent } from "./sectional-openai-podcast-agent.js"

const articleIds = Array.from(
  { length: 6 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
)

const articles = articleIds.map((id, index) => ({
  id,
  snapshotId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  feedId: "20000000-0000-4000-8000-000000000001",
  sourceName: "Example",
  title: `記事${index + 1}`,
  url: new URL(`https://example.com/${index + 1}`),
}))

function audit(): AgentAudit {
  return {
    start: vi.fn(() => "run-1"),
    tool: vi.fn(),
    finish: vi.fn(),
  }
}

describe("SectionalOpenAiPodcastAgent", () => {
  it("finds structured output after a reasoning item", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "classification",
          status: "completed",
          output: [
            { type: "reasoning", id: "reasoning-1", summary: [] },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    groups: [{ topic: "技術", articleIds }],
                  }),
                },
              ],
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "read",
          output: articleIds.map((articleId, index) => ({
            type: "function_call",
            name: "read_article",
            arguments: JSON.stringify({ article_id: articleId }),
            call_id: `read-${index}`,
          })),
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "submit",
          output: [
            {
              type: "function_call",
              name: "submit_episode_draft",
              arguments: JSON.stringify({
                title: "技術ニュース",
                script:
                  "選択された記事をすべて確認した技術ニュースです。".repeat(8),
                source_urls: articles.map((article) => article.url.href),
              }),
              call_id: "submit-1",
            },
          ],
        })
      )

    const agent = createAgent(fetcher)

    await expect(agent.run(runInput())).resolves.toMatchObject({
      title: "技術ニュース",
      sourceUrls: articles.map((article) => article.url),
    })

    const classificationRequest = JSON.parse(
      String(fetcher.mock.calls[0]?.[1]?.body)
    ) as { text?: { format?: { type?: string; strict?: boolean } } }
    expect(classificationRequest.text?.format).toMatchObject({
      type: "json_schema",
      strict: true,
    })
  })

  it("classifies a completed response without output text as retryable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ id: "empty", status: "completed", output: [] })
      )
    const agent = createAgent(fetcher)

    const error = await agent.run(runInput()).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(PodcastAgentError)
    expect(error).toMatchObject({ retryable: true })
  })

  it("wraps a transport failure as retryable", async () => {
    const agent = createAgent(
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    )

    const error = await agent.run(runInput()).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(PodcastAgentError)
    expect(error).toMatchObject({ retryable: true })
  })

  it("does not retry a request-contract 400", async () => {
    const agent = createAgent(
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "invalid schema" } },
            { status: 400 }
          )
        )
    )

    const error = await agent.run(runInput()).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(PodcastAgentError)
    expect(error).toMatchObject({ retryable: false })
    expect(error).toHaveProperty(
      "message",
      "OpenAI request failed with 400: invalid schema"
    )
  })

  it("propagates the caller cancellation reason", async () => {
    const controller = new AbortController()
    const reason = new Error("job-canceled")
    const fetcher = vi.fn(() => {
      controller.abort(reason)
      return Promise.reject(reason)
    })
    const agent = createAgent(fetcher)

    await expect(
      agent.run({ ...runInput(), signal: controller.signal })
    ).rejects.toBe(reason)
  })
})

function createAgent(fetcher: ReturnType<typeof vi.fn>) {
  return new SectionalOpenAiPodcastAgent(
    { apiKey: "test", model: "test-model" },
    {
      listArticles: vi.fn(() => Promise.resolve(articles)),
      readArticle: vi.fn(({ articleId }) => {
        const article = articles.find((value) => value.id === articleId)
        if (!article) throw new Error("article-not-found")
        return Promise.resolve({
          article,
          markdown: `# ${article.title}\n本文`,
        })
      }),
    },
    audit(),
    fetcher as unknown as typeof fetch
  )
}

function runInput() {
  return {
    jobId: "30000000-0000-4000-8000-000000000001",
    ownerId: "owner",
    feedIds: ["20000000-0000-4000-8000-000000000001"],
    articleIds,
  }
}
