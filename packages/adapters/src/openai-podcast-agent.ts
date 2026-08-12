import { z } from "zod"

import type {
  EpisodeScriptDraft,
  PodcastAgentContext,
  PodcastAgentRunner,
} from "@news-podcast/application"
import type { OpenAiConfig } from "./config.js"

const MAX_TURNS = 8
const MAX_TOOL_CALLS = 40
const MAX_SOURCE_CORRECTIONS = 2
const MAX_SCRIPT_LENGTH = 6_000
/** 契約側の MAX_SELECTED_ARTICLES と揃える。 */
const MAX_SELECTED_ARTICLES = 20

type StrictFunctionParameter =
  | {
      readonly type: "object"
      readonly additionalProperties: false
      readonly required: readonly string[]
      readonly properties: Readonly<Record<string, StrictFunctionParameter>>
    }
  | {
      readonly type: "array"
      readonly minItems?: number
      readonly items: StrictFunctionParameter
    }
  | {
      readonly type: "string"
      readonly minLength?: number
      readonly maxLength?: number
    }
  | {
      readonly type: "integer"
      readonly minimum?: number
      readonly maximum?: number
    }

type StrictFunctionTool = {
  readonly type: "function"
  readonly name: string
  readonly description: string
  readonly strict: true
  readonly parameters: Extract<StrictFunctionParameter, { type: "object" }>
}

type PodcastAgentTool = StrictFunctionTool | { readonly type: "web_search" }

const PODCAST_AGENT_TOOLS = [
  {
    type: "function",
    name: "list_rss_articles",
    description: "購読中の、アーカイブが完了したRSS記事を新しい順に一覧する。",
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
    description: "RSS記事の保存済みMarkdown本文を読む。内容を使う前に呼ぶ。",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["article_id"],
      properties: { article_id: { type: "string" } },
    },
  },
  { type: "web_search" },
  {
    type: "function",
    name: "submit_episode_draft",
    description:
      "台本（タイトル・本文）と使用した出典URLを提出する。",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "script", "source_urls"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 200 },
        script: {
          type: "string",
          minLength: 100,
          maxLength: MAX_SCRIPT_LENGTH,
        },
        source_urls: {
          type: "array",
          minItems: 1,
          // URLs are parsed and validated after the tool call is returned.
          // Responses strict function schemas do not accept `format: "uri"`.
          items: { type: "string" },
        },
      },
    },
  },
] as const satisfies readonly PodcastAgentTool[]

const SubmitDraft = z.object({
  title: z.string().min(1).max(200),
  script: z.string().min(100).max(MAX_SCRIPT_LENGTH),
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
  readonly status?: string
  readonly incomplete_details?: { readonly reason?: string }
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
  /**
   * エージェントが実際に本文を読んだ記事。「採用記事のライブ表示」の
   * 実データになる。監査だけを行う実装は省略してよい。
   */
  articleAdopted?(input: {
    readonly runId: string
    readonly articleId: string
    readonly title: string
    readonly url: string
    readonly sourceName: string
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
    readonly articleIds?: readonly string[]
    readonly signal?: AbortSignal
  }): Promise<EpisodeScriptDraft> {
    const runId = this.audit.start({
      jobId: input.jobId,
      ownerId: input.ownerId,
      model: this.config.model,
    })
    const selectedArticleIds = new Set(input.articleIds ?? [])
    const allowedRssUrls = new Set<string>()
    const readArticleIds = new Set<string>()
    const observedWebUrls = new Set<string>()
    let previousResponseId: string | undefined
    let nextInput: unknown
    let toolCalls = 0
    let sourceCorrections = 0

    try {
      nextInput = selectedArticleIds.size
        ? await this.buildSelectedArticlesPrompt(input)
        : "購読中のRSS記事から、今聴く価値のあるニュースを選び、本文を読んで要点を抽出せよ。事実確認に必要な時だけweb_searchを使え。台本が完成したらsubmit_episode_draftを呼べ。"
      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const response = await this.request({
          input: nextInput,
          ...(previousResponseId ? { previousResponseId } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        })
        previousResponseId = response.id
        if (response.status === "incomplete") {
          throw new PodcastAgentError(
            `OpenAI response was incomplete (${response.incomplete_details?.reason ?? "unknown"})`
          )
        }
        if (containsRefusal(response.output ?? [])) {
          throw new PodcastAgentError("OpenAI refused agent output", false)
        }
        collectObservedWebUrls(response.output ?? [], observedWebUrls)
        const calls = (response.output ?? []).filter(isFunctionCall)
        if (calls.length === 0) {
          throw new PodcastAgentError(
            "Agent stopped without submitting an episode draft"
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
            const unobservedUrls = urls.filter(
              (url) =>
                !allowedRssUrls.has(url.href) && !observedWebUrls.has(url.href)
            )
            const unreadArticleIds = [...selectedArticleIds].filter(
              (articleId) => !readArticleIds.has(articleId)
            )
            const submittedUrls = new Set(urls.map((url) => url.href))
            const missingSelectedSourceUrls =
              selectedArticleIds.size === 0
                ? []
                : [...allowedRssUrls].filter(
                    (url) => !submittedUrls.has(url)
                  )
            if (
              unobservedUrls.length > 0 ||
              unreadArticleIds.length > 0 ||
              missingSelectedSourceUrls.length > 0
            ) {
              sourceCorrections += 1
              if (sourceCorrections > MAX_SOURCE_CORRECTIONS) {
                throw new PodcastAgentError(
                  "Agent output remained invalid after source correction limit",
                  false
                )
              }
              const correction = {
                ok: false,
                code:
                  unreadArticleIds.length > 0 ||
                  missingSelectedSourceUrls.length > 0
                    ? "draft_evidence_incomplete"
                    : "source_not_observed",
                invalid_source_urls: unobservedUrls.map((url) => url.href),
                unread_article_ids: unreadArticleIds,
                missing_selected_source_urls: missingSelectedSourceUrls,
                correction_attempt: sourceCorrections,
                correction_limit: MAX_SOURCE_CORRECTIONS,
                instruction:
                  "Read every selected article, cite every selected article URL, and use only sources observed through read_article or web_search. Then submit the complete draft again.",
              }
              this.audit.tool({
                runId,
                position: toolCalls - 1,
                name: call.name,
                argumentsJson: call.arguments,
                outputSummary: correction,
              })
              outputs.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: JSON.stringify(correction),
              })
              continue
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
          const result = await this.executeTool(
            call,
            input,
            allowedRssUrls,
            selectedArticleIds,
            readArticleIds,
            runId
          )
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
      if (input.signal?.aborted) throw input.signal.reason
      if (error instanceof PodcastAgentError) throw error
      throw new PodcastAgentError(
        error instanceof Error ? error.message : "Unknown agent failure"
      )
    }
  }

  /**
   * ユーザーが記事を明示選択した場合の初期指示。選択記事を全件列挙し、
   * これ以外を主題にしないことを明示する。
   */
  private async buildSelectedArticlesPrompt(input: {
    readonly ownerId: string
    readonly feedIds: readonly string[]
    readonly articleIds?: readonly string[]
  }): Promise<string> {
    const articles = await this.context.listArticles({
      ownerId: input.ownerId,
      feedIds: input.feedIds,
      limit: MAX_SELECTED_ARTICLES,
      ...(input.articleIds ? { articleIds: input.articleIds } : {}),
    })
    const availableIds = new Set(articles.map((article) => article.id))
    const missingSelectedArticles = (input.articleIds ?? []).filter(
      (articleId) => !availableIds.has(articleId)
    )
    if (missingSelectedArticles.length > 0) {
      throw new PodcastAgentError(
        `Selected article set is incomplete (${missingSelectedArticles.length} unavailable)`,
        false
      )
    }
    const list = articles
      .map(
        (article, index) =>
          `${index + 1}. [${article.id}] ${article.title}（${article.sourceName}）`
      )
      .join("\n")
    return [
      "以下の記事だけを番組で扱う。全てread_articleで読め。",
      list,
      "",
      "選ばれていない記事を主題にするな。web_searchは事実確認時のみ。",
      "完成したらsubmit_episode_draft。",
    ].join("\n")
  }

  private async executeTool(
    call: FunctionCall,
    input: {
      readonly ownerId: string
      readonly feedIds: readonly string[]
      readonly articleIds?: readonly string[]
    },
    allowedRssUrls: Set<string>,
    selectedArticleIds: ReadonlySet<string>,
    readArticleIds: Set<string>,
    runId: string
  ): Promise<unknown> {
    const args = JSON.parse(call.arguments) as Record<string, unknown>
    if (call.name === "list_rss_articles") {
      const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50)
      const articles = await this.context.listArticles({
        ownerId: input.ownerId,
        feedIds: input.feedIds,
        limit,
        ...(input.articleIds ? { articleIds: input.articleIds } : {}),
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
      // 選択がある場合はその外側を読ませない。ハードエラーではなくツール結果と
      // して返し、エージェントが自己修正できるようにする。
      if (selectedArticleIds.size > 0 && !selectedArticleIds.has(articleId)) {
        return {
          ok: false,
          code: "article_not_selected",
          selected_article_ids: [...selectedArticleIds],
          instruction:
            "This episode is restricted to the articles the user selected. Read only those.",
        }
      }
      const value = await this.context.readArticle({
        ownerId: input.ownerId,
        articleId,
      })
      readArticleIds.add(articleId)
      allowedRssUrls.add(value.article.url.href)
      this.audit.articleAdopted?.({
        runId,
        articleId: value.article.id,
        title: value.article.title,
        url: value.article.url.href,
        sourceName: value.article.sourceName,
      })
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
    readonly signal?: AbortSignal
  }): Promise<OpenAiResponse> {
    const response = await this.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: this.config.model,
        instructions:
          "あなたはニュースPodcast編集者だ。記事本文を読み、本質的な要点だけを抜き出して台本を書け。前置き・免責事項・定型文は一切省け。抽象的な説明の後に具体的な数字・事例を入れ、納得感のある構成にせよ。句読点は読み上げて自然な位置にだけ打て。語尾は「〜た」「〜だ」「〜する」で締めよ。web_searchは事実確認が必要な時だけ使え。",
        input: input.input,
        ...(input.previousResponseId
          ? { previous_response_id: input.previousResponseId }
          : {}),
        parallel_tool_calls: false,
        include: ["web_search_call.action.sources"],
        tools: PODCAST_AGENT_TOOLS,
      }),
    })
    if (!response.ok) {
      throw new PodcastAgentError(
        `OpenAI request failed with ${response.status}: ${await readOpenAiError(
          response
        )}`,
        isRetryableProviderStatus(response.status)
      )
    }
    return (await response.json()) as OpenAiResponse
  }
}

function containsRefusal(responseOutput: readonly unknown[]): boolean {
  return responseOutput.some((value) => {
    if (!value || typeof value !== "object") return false
    const content = (value as Record<string, unknown>).content
    return (
      Array.isArray(content) &&
      content.some(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          (item as Record<string, unknown>).type === "refusal"
      )
    )
  })
}

export function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

export async function readOpenAiError(response: Response): Promise<string> {
  const fallback = response.statusText || "Unknown API error"
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown; code?: unknown; param?: unknown }
    }
    const error = payload.error
    if (!error || typeof error.message !== "string") return fallback
    const details = [
      typeof error.code === "string" ? error.code : undefined,
      typeof error.param === "string" ? error.param : undefined,
      error.message,
    ].filter((value): value is string => Boolean(value))
    return details.join(" — ").slice(0, 1_000)
  } catch {
    return fallback
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

function collectObservedWebUrls(
  responseOutput: readonly unknown[],
  output: Set<string>
): void {
  for (const value of responseOutput) {
    if (!value || typeof value !== "object") continue
    const item = value as Record<string, unknown>
    if (item.type !== "web_search_call") continue
    const action = item.action
    if (!action || typeof action !== "object") continue
    const sources = (action as Record<string, unknown>).sources
    if (!Array.isArray(sources)) continue
    for (const source of sources) {
      if (!source || typeof source !== "object") continue
      const url = (source as Record<string, unknown>).url
      if (typeof url !== "string") continue
      try {
        output.add(new URL(url).href)
      } catch {
        // Ignore malformed provider metadata rather than trusting it as a source.
      }
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
