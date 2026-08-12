import { describe, expect, it, vi } from "vitest"

import {
  OpenAiPodcastAgent,
  PodcastAgentError,
} from "./openai-podcast-agent.js"

describe("OpenAiPodcastAgent", () => {
  it("lets the model list and read archived RSS articles before submitting", async () => {
    const fetcherMock = vi
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
      )
    const fetcher = fetcherMock as unknown as typeof fetch
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
    const firstRequest = fetcherMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(firstRequest?.body)) as {
      include?: readonly string[]
      tools: readonly {
        name?: string
        parameters?: {
          properties?: {
            source_urls?: { items?: Record<string, unknown> }
            script?: Record<string, unknown>
          }
        }
      }[]
    }
    const submitTool = body.tools.find(
      (tool) => tool.name === "submit_episode_draft"
    )
    expect(submitTool?.parameters?.properties?.source_urls?.items).toEqual({
      type: "string",
    })
    expect(JSON.stringify(body.tools)).not.toContain('"format"')
    expect(body.include).toEqual(["web_search_call.action.sources"])
    expect(
      submitTool?.parameters?.properties?.script
    ).toMatchObject({ minLength: 100, maxLength: 6_000 })
  })

  it("repairs a draft that omitted a selected article and its source", async () => {
    const article = {
      id: "00000000-0000-4000-8000-000000000010",
      snapshotId: "00000000-0000-4000-8000-000000000011",
      feedId: "00000000-0000-4000-8000-000000000012",
      sourceName: "Example",
      title: "選択記事",
      url: new URL("https://example.com/selected"),
    }
    const fetcherMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "response-1",
          output: [draftCall("submit-1", article.url.href)],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "response-2",
          output: [
            {
              type: "function_call",
              name: "read_article",
              arguments: JSON.stringify({ article_id: article.id }),
              call_id: "read-1",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "response-3",
          output: [draftCall("submit-2", article.url.href)],
        })
      )
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      {
        listArticles: vi.fn(() => Promise.resolve([article])),
        readArticle: vi.fn(() =>
          Promise.resolve({ article, markdown: "# 選択記事\n本文" })
        ),
      },
      { start: vi.fn(() => "run-1"), tool: vi.fn(), finish: vi.fn() },
      fetcherMock as unknown as typeof fetch
    )

    await expect(
      agent.run({
        jobId: "job-1",
        ownerId: "owner",
        feedIds: [article.feedId],
        articleIds: [article.id],
      })
    ).resolves.toMatchObject({ sourceUrls: [article.url] })

    const correctionRequest = JSON.parse(
      String(fetcherMock.mock.calls[1]?.[1]?.body)
    ) as { input: { output: string }[] }
    expect(JSON.parse(correctionRequest.input[0]?.output ?? "{}")).toMatchObject(
      {
        ok: false,
        code: "draft_evidence_incomplete",
        unread_article_ids: [article.id],
      }
    )
  })

  it("treats an empty completed response as retryable", async () => {
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      { listArticles: vi.fn(), readArticle: vi.fn() },
      { start: vi.fn(() => "run-1"), tool: vi.fn(), finish: vi.fn() },
      vi.fn().mockResolvedValue(
        Response.json({ id: "response-1", status: "completed", output: [] })
      ) as unknown as typeof fetch
    )

    await expect(
      agent.run({ jobId: "job-1", ownerId: "owner", feedIds: [] })
    ).rejects.toMatchObject({ retryable: true })
  })

  it("does not retry an invalid OpenAI request", async () => {
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      { listArticles: vi.fn(), readArticle: vi.fn() },
      { start: vi.fn(() => "run-1"), tool: vi.fn(), finish: vi.fn() },
      vi.fn().mockResolvedValue(
        Response.json({ error: { message: "invalid request" } }, { status: 400 })
      ) as unknown as typeof fetch
    )

    const error = await agent
      .run({ jobId: "job-1", ownerId: "owner", feedIds: [] })
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(PodcastAgentError)
    expect(error).toMatchObject({ retryable: false })
  })

  it("propagates the caller cancellation reason", async () => {
    const controller = new AbortController()
    const reason = new Error("lease-lost")
    const fetcher = vi.fn(() => {
      controller.abort(reason)
      return Promise.reject(reason)
    })
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      { listArticles: vi.fn(), readArticle: vi.fn() },
      { start: vi.fn(() => "run-1"), tool: vi.fn(), finish: vi.fn() },
      fetcher as unknown as typeof fetch
    )

    await expect(
      agent.run({
        jobId: "job-1",
        ownerId: "owner",
        feedIds: [],
        signal: controller.signal,
      })
    ).rejects.toBe(reason)
  })

  it("finishes the audit run when selected-article loading fails", async () => {
    const audit = {
      start: vi.fn(() => "run-1"),
      tool: vi.fn(),
      finish: vi.fn(),
    }
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      {
        listArticles: vi.fn(() => Promise.reject(new Error("store unavailable"))),
        readArticle: vi.fn(),
      },
      audit,
      vi.fn() as unknown as typeof fetch
    )

    await expect(
      agent.run({
        jobId: "job-1",
        ownerId: "owner",
        feedIds: [],
        articleIds: ["00000000-0000-4000-8000-000000000010"],
      })
    ).rejects.toMatchObject({ retryable: true })
    expect(audit.finish).toHaveBeenCalledWith("run-1", "agent-run-failed")
  })

  it("rejects an unavailable selected article before calling the model", async () => {
    const audit = {
      start: vi.fn(() => "run-1"),
      tool: vi.fn(),
      finish: vi.fn(),
    }
    const fetcher = vi.fn()
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      { listArticles: vi.fn(() => Promise.resolve([])), readArticle: vi.fn() },
      audit,
      fetcher as unknown as typeof fetch
    )

    const error = await agent
      .run({
        jobId: "job-1",
        ownerId: "owner",
        feedIds: [],
        articleIds: ["00000000-0000-4000-8000-000000000010"],
      })
      .catch((value: unknown) => value)

    expect(error).toBeInstanceOf(PodcastAgentError)
    expect(error).toMatchObject({ retryable: false })
    expect(fetcher).not.toHaveBeenCalled()
    expect(audit.finish).toHaveBeenCalledWith("run-1", "agent-run-failed")
  })

  it("accepts only URLs reported by the hosted web search source list", async () => {
    const sourceUrl = "https://example.com/official-source"
    const fetcherMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "response-1",
        output: [
          {
            type: "web_search_call",
            id: "search-1",
            action: {
              type: "search",
              query: "official source",
              sources: [{ type: "url", url: sourceUrl }],
            },
          },
          {
            type: "function_call",
            name: "submit_episode_draft",
            arguments: JSON.stringify({
              title: "検索ニュース",
              script: "公式Web検索の結果を根拠にしたニュースです。".repeat(8),
              source_urls: [sourceUrl],
            }),
            call_id: "call-1",
          },
        ],
      })
    )
    const audit = {
      start: vi.fn(() => "run-1"),
      tool: vi.fn(),
      finish: vi.fn(),
    }
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      { listArticles: vi.fn(), readArticle: vi.fn() },
      audit,
      fetcherMock as unknown as typeof fetch
    )

    await expect(
      agent.run({ jobId: "job-1", ownerId: "owner", feedIds: [] })
    ).resolves.toMatchObject({ sourceUrls: [new URL(sourceUrl)] })
  })

  it("returns a structured correction and accepts a repaired draft in the same run", async () => {
    const missingUrl = "https://example.com/missing"
    const fetcherMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "response-1",
          output: [draftCall("call-1", missingUrl)],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "response-2",
          output: [
            {
              type: "web_search_call",
              action: { sources: [{ url: missingUrl }] },
            },
            draftCall("call-2", missingUrl),
          ],
        })
      )
    const audit = {
      start: vi.fn(() => "run-1"),
      tool: vi.fn(),
      finish: vi.fn(),
    }
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      { listArticles: vi.fn(), readArticle: vi.fn() },
      audit,
      fetcherMock as unknown as typeof fetch
    )

    await expect(
      agent.run({ jobId: "job-1", ownerId: "owner", feedIds: [] })
    ).resolves.toMatchObject({ sourceUrls: [new URL(missingUrl)] })

    const secondRequest = fetcherMock.mock.calls[1]?.[1]
    const body = JSON.parse(String(secondRequest?.body)) as {
      input: { output: string }[]
    }
    expect(JSON.parse(body.input[0]?.output ?? "{}")).toMatchObject({
      ok: false,
      code: "source_not_observed",
      invalid_source_urls: [missingUrl],
      correction_attempt: 1,
      correction_limit: 2,
    })
    expect(audit.finish).toHaveBeenCalledWith("run-1")
  })

  it("fails only after the source correction limit is exceeded", async () => {
    const fetcherMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "response-1",
          output: [draftCall("call-1", "https://example.com/one")],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "response-2",
          output: [draftCall("call-2", "https://example.com/two")],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "response-3",
          output: [draftCall("call-3", "https://example.com/three")],
        })
      )
    const audit = {
      start: vi.fn(() => "run-1"),
      tool: vi.fn(),
      finish: vi.fn(),
    }
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      { listArticles: vi.fn(), readArticle: vi.fn() },
      audit,
      fetcherMock as unknown as typeof fetch
    )

    await expect(
      agent.run({ jobId: "job-1", ownerId: "owner", feedIds: [] })
    ).rejects.toThrow(
      "Agent output remained invalid after source correction limit"
    )
    expect(fetcherMock).toHaveBeenCalledTimes(3)
    expect(audit.finish).toHaveBeenCalledWith("run-1", "agent-run-failed")
  })

  it("includes OpenAI validation details in a failed request", async () => {
    const fetcherMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            message: "Invalid schema for function 'submit_episode_draft'",
            code: "invalid_function_parameters",
            param: "tools[3].parameters",
          },
        },
        { status: 400, statusText: "Bad Request" }
      )
    )
    const audit = {
      start: vi.fn(() => "run-1"),
      tool: vi.fn(),
      finish: vi.fn(),
    }
    const agent = new OpenAiPodcastAgent(
      { apiKey: "test", model: "test-model" },
      { listArticles: vi.fn(), readArticle: vi.fn() },
      audit,
      fetcherMock as unknown as typeof fetch
    )

    await expect(
      agent.run({
        jobId: "00000000-0000-4000-8000-000000000001",
        ownerId: "owner",
        feedIds: [],
      })
    ).rejects.toThrow(
      "invalid_function_parameters — tools[3].parameters — Invalid schema"
    )
    expect(audit.finish).toHaveBeenCalledWith("run-1", "agent-run-failed")
  })
})

function draftCall(callId: string, sourceUrl: string) {
  return {
    type: "function_call",
    name: "submit_episode_draft",
    arguments: JSON.stringify({
      title: "修正対象ニュース",
      script: "出典を確認して制作したニュースです。".repeat(10),
      source_urls: [sourceUrl],
    }),
    call_id: callId,
  }
}
