import { z } from "zod"

import type {
  EpisodeScriptDraft,
  PodcastAgentContext,
  PodcastAgentRunner,
} from "@news-podcast/application"
import type { OpenAiConfig } from "./config.js"

const MAX_TURNS = 8
const MAX_TOOL_CALLS = 16

const SubmitDraft = z.object({
  title: z.string().min(1).max(200),
  script: z.string().min(100),
  source_urls: z.array(z.url()).min(1),
})

interface FunctionCall {
  readonly type: "function_call"
  readonly name: string
  readonly arguments: string
  readonly call_id: string
}

interface OpenAiResponse {
  readonly id: string
  readonly output?: readonly unknown[]
}

export interface AgentAudit {
  start(input: {
    readonly jobId: string
    readonly ownerId: string
    readonly model: string
  }): string
  tool(input: {
    readonly runId: string
    readonly position: number
    readonly name: string
    readonly argumentsJson: string
    readonly outputSummary: unknown
  }): void
  finish(runId: string, failureCode?: string): void
}

export class PodcastAgentError extends Error {
  constructor(
    message: string,
    readonly retryable = true
  ) {
    super(message)
    this.name = "PodcastAgentError"
  }
}

export class OpenAiPodcastAgent implements PodcastAgentRunner {
  constructor(
    private readonly config: OpenAiConfig,
    private readonly context: PodcastAgentContext,
    private readonly audit: AgentAudit,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async run(input: {
    readonly jobId: string
    readonly ownerId: string
    readonly feedIds: readonly string[]
  }): Promise<EpisodeScriptDraft> {
    const runId = this.audit.start({
      jobId: input.jobId,
      ownerId: input.ownerId,
      model: this.config.model,
    })
    const allowedRssUrls = new Set<string>()
    const observedWebUrls = new Set<string>()
    let previousResponseId: string | undefined
    let nextInput: unknown =
      "購読中のRSS記事から、今聴く価値のある日本語ニュースPodcastを制作してください。記事本文を読み、必要な場合だけWeb検索で補足確認し、完成したらsubmit_episode_draftを呼んでください。"
    let toolCalls = 0

    try {
      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const response = await this.request({
          input: nextInput,
          ...(previousResponseId ? { previousResponseId } : {}),
        })
        previousResponseId = response.id
        collectObservedUrls(response.output ?? [], observedWebUrls)
        const calls = (response.output ?? []).filter(isFunctionCall)
        if (calls.length === 0) {
          throw new PodcastAgentError(
            "Agent stopped without submitting an episode draft",
            false
          )
        }
        const outputs: unknown[] = []
        for (const call of calls) {
          toolCalls += 1
          if (toolCalls > MAX_TOOL_CALLS) {
            throw new PodcastAgentError("Agent tool-call limit exceeded", false)
          }
          if (call.name === "submit_episode_draft") {
            const draft = SubmitDraft.parse(JSON.parse(call.arguments))
            const urls = draft.source_urls.map((value) => new URL(value))
            if (
              urls.some(
                (url) =>
                  !allowedRssUrls.has(url.href) &&
                  !observedWebUrls.has(url.href)
              )
            ) {
              throw new PodcastAgentError(
                "Agent referenced a source that was not read or searched",
                false
              )
            }
            this.audit.tool({
              runId,
              position: toolCalls - 1,
              name: call.name,
              argumentsJson: call.arguments,
              outputSummary: { title: draft.title, sourceCount: urls.length },
            })
            this.audit.finish(runId)
            return {
              title: draft.title,
              script: draft.script,
              sourceUrls: urls,
            }
          }
          const result = await this.executeTool(call, input, allowedRssUrls)
          this.audit.tool({
            runId,
            position: toolCalls - 1,
            name: call.name,
            argumentsJson: call.arguments,
            outputSummary: summarizeToolResult(call.name, result),
          })
          outputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          })
        }
        nextInput = outputs
      }
      throw new PodcastAgentError("Agent turn limit exceeded", false)
    } catch (error) {
      this.audit.finish(runId, "agent-run-failed")
      if (error instanceof PodcastAgentError) throw error
      throw new PodcastAgentError(
        error instanceof Error ? error.message : "Unknown agent failure"
      )
    }
  }

  private async executeTool(
    call: FunctionCall,
    input: {
      readonly ownerId: string
      readonly feedIds: readonly string[]
    },
    allowedRssUrls: Set<string>
  ): Promise<unknown> {
    const args = JSON.parse(call.arguments) as Record<string, unknown>
    if (call.name === "list_rss_articles") {
      const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50)
      const articles = await this.context.listArticles({
        ownerId: input.ownerId,
        feedIds: input.feedIds,
        limit,
      })
      return articles.map((article) => ({
        id: article.id,
        source: article.sourceName,
        title: article.title,
        url: article.url.href,
        published_at: article.publishedAt?.toISOString(),
        summary: article.summary,
      }))
    }
    if (call.name === "read_article") {
      const articleId = z.string().uuid().parse(args.article_id)
      const value = await this.context.readArticle({
        ownerId: input.ownerId,
        articleId,
      })
      allowedRssUrls.add(value.article.url.href)
      return {
        id: value.article.id,
        title: value.article.title,
        url: value.article.url.href,
        markdown: value.markdown,
      }
    }
    throw new PodcastAgentError(`Unknown agent tool: ${call.name}`, false)
  }

  private async request(input: {
    readonly input: unknown
    readonly previousResponseId?: string
  }): Promise<OpenAiResponse> {
    const response = await this.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: this.config.model,
        instructions:
          "あなたは自主的なニュースPodcast編集者です。RSS記事を主題の起点にし、本文を読んで重要性を判断してください。必要な場合だけWeb検索で補足確認してください。根拠のない事実を追加せず、自然な日本語の単独ナレーションを作ってください。ツールの取得範囲と実行上限を守ってください。",
        input: input.input,
        ...(input.previousResponseId
          ? { previous_response_id: input.previousResponseId }
          : {}),
        parallel_tool_calls: false,
        tools: [
          {
            type: "function",
            name: "list_rss_articles",
            description:
              "購読中の、アーカイブが完了したRSS記事を新しい順に一覧する。",
            strict: true,
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["limit"],
              properties: {
                limit: { type: "integer", minimum: 1, maximum: 50 },
              },
            },
          },
          {
            type: "function",
            name: "read_article",
            description:
              "RSS記事の保存済みMarkdown本文を読む。内容を使う前に呼ぶ。",
            strict: true,
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["article_id"],
              properties: { article_id: { type: "string", format: "uuid" } },
            },
          },
          { type: "web_search" },
          {
            type: "function",
            name: "submit_episode_draft",
            description:
              "完成したPodcast台本と、実際に使用したRSSまたはWeb検索の出典URLを提出する。",
            strict: true,
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["title", "script", "source_urls"],
              properties: {
                title: { type: "string" },
                script: { type: "string" },
                source_urls: {
                  type: "array",
                  minItems: 1,
                  items: { type: "string", format: "uri" },
                },
              },
            },
          },
        ],
      }),
    })
    if (!response.ok) {
      throw new PodcastAgentError(
        `OpenAI request failed with ${response.status}`
      )
    }
    return (await response.json()) as OpenAiResponse
  }
}

function isFunctionCall(value: unknown): value is FunctionCall {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return (
    item.type === "function_call" &&
    typeof item.name === "string" &&
    typeof item.arguments === "string" &&
    typeof item.call_id === "string"
  )
}

function collectObservedUrls(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectObservedUrls(item, output))
    return
  }
  if (!value || typeof value !== "object") return
  const item = value as Record<string, unknown>
  if (item.type === "function_call") return
  for (const [key, child] of Object.entries(item)) {
    if ((key === "url" || key === "source_url") && typeof child === "string") {
      try {
        output.add(new URL(child).href)
      } catch {
        // Ignore non-URL provider metadata.
      }
    } else {
      collectObservedUrls(child, output)
    }
  }
}

function summarizeToolResult(name: string, result: unknown): unknown {
  if (name === "list_rss_articles" && Array.isArray(result)) {
    return { articleCount: result.length }
  }
  if (name === "read_article" && result && typeof result === "object") {
    const value = result as Record<string, unknown>
    return {
      articleId: value.id,
      markdownLength:
        typeof value.markdown === "string" ? value.markdown.length : 0,
    }
  }
  return { completed: true }
}
