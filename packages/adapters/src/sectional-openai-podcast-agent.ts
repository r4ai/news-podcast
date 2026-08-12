import { z } from "zod"

import type {
  AgentArticle,
  EpisodeScriptDraft,
  PodcastAgentContext,
  PodcastAgentRunner,
} from "@news-podcast/application"
import type { OpenAiConfig } from "./config.js"
import {
  OpenAiPodcastAgent,
  PodcastAgentError,
  isRetryableProviderStatus,
  readOpenAiError,
  type AgentAudit,
} from "./openai-podcast-agent.js"

const MIN_ARTICLES_FOR_SECTIONAL = 6
const MAX_ARTICLES_PER_SECTION = 6
const MAX_SCRIPT_LENGTH = 6_000

const TopicGroupsResponse = z
  .object({
    groups: z
      .array(
        z
          .object({
            topic: z.string().min(1).max(100),
            articleIds: z
              .array(z.string().uuid())
              .min(1)
              .max(MAX_ARTICLES_PER_SECTION),
          })
          .strict()
      )
      .min(1),
  })
  .strict()

const MergedDraftResponse = z
  .object({
    title: z.string().min(1).max(200),
    script: z.string().min(100).max(MAX_SCRIPT_LENGTH),
  })
  .strict()

const TOPIC_GROUPS_FORMAT = {
  type: "json_schema",
  name: "podcast_topic_groups",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["groups"],
    properties: {
      groups: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["topic", "articleIds"],
          properties: {
            topic: { type: "string", minLength: 1, maxLength: 100 },
            articleIds: {
              type: "array",
              minItems: 1,
              maxItems: MAX_ARTICLES_PER_SECTION,
              items: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const

const MERGED_DRAFT_FORMAT = {
  type: "json_schema",
  name: "merged_podcast_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "script"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      script: {
        type: "string",
        minLength: 100,
        maxLength: MAX_SCRIPT_LENGTH,
      },
    },
  },
} as const

interface TopicGroup {
  readonly topic: string
  readonly articleIds: readonly string[]
}

interface SectionDraft {
  readonly topic: string
  readonly title: string
  readonly script: string
  readonly sourceUrls: readonly URL[]
}

export class SectionalOpenAiPodcastAgent implements PodcastAgentRunner {
  private readonly singleAgent: OpenAiPodcastAgent
  private readonly config: OpenAiConfig

  constructor(
    config: OpenAiConfig,
    private readonly context: PodcastAgentContext,
    private readonly audit: AgentAudit,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.config = config
    this.singleAgent = new OpenAiPodcastAgent(config, context, audit, fetcher)
  }

  async run(input: {
    readonly jobId: string
    readonly ownerId: string
    readonly feedIds: readonly string[]
    readonly articleIds?: readonly string[]
    readonly signal?: AbortSignal
  }): Promise<EpisodeScriptDraft> {
    const articleIds = input.articleIds ?? []
    if (articleIds.length < MIN_ARTICLES_FOR_SECTIONAL) {
      return this.singleAgent.run(input)
    }

    const articles = await this.context.listArticles({
      ownerId: input.ownerId,
      feedIds: input.feedIds,
      limit: articleIds.length,
      articleIds,
    })

    const groups = await this.classifyTopics(articles, input.signal)

    const sections: SectionDraft[] = []
    for (const group of groups) {
      if (input.signal?.aborted) throw input.signal.reason
      const sectionDraft = await this.generateSection(input, group)
      sections.push({ topic: group.topic, ...sectionDraft })
    }

    return this.mergeSections(sections, input)
  }

  private async classifyTopics(
    articles: readonly AgentArticle[],
    signal?: AbortSignal
  ): Promise<readonly TopicGroup[]> {
    const articleList = articles
      .map(
        (a, i) =>
          `${i + 1}. [${a.id}] ${a.title}（${a.sourceName}）${a.summary ? `\n   概要: ${a.summary}` : ""}`
      )
      .join("\n")

    const prompt = [
      "以下の記事一覧を、共通の話題でグループ分けせよ。",
      `1グループ最大${MAX_ARTICLES_PER_SECTION}記事、各記事は1グループのみ所属。`,
      "指定されたJSON Schemaのオブジェクト形式で出力せよ。",
      "",
      "出力形式:",
      '{ "groups": [ { "topic": "グループ名", "articleIds": ["uuid1", "uuid2"] } ] }',
      "",
      "記事一覧:",
      articleList,
    ].join("\n")

    const parsed = parseStructuredOutput(
      TopicGroupsResponse,
      await this.callOpenAi(prompt, TOPIC_GROUPS_FORMAT, signal)
    ).groups

    const knownIds = new Set(articles.map((article) => article.id))
    const assigned = new Set<string>()
    const groups: TopicGroup[] = []
    for (const group of parsed) {
      const uniqueIds: string[] = []
      for (const id of group.articleIds) {
        if (assigned.has(id) || !knownIds.has(id)) continue
        assigned.add(id)
        uniqueIds.push(id)
      }
      if (uniqueIds.length > 0) {
        groups.push({ topic: group.topic, articleIds: uniqueIds })
      }
    }

    const unassigned = articles
      .filter((a) => !assigned.has(a.id))
      .map((a) => a.id)
    for (let i = 0; i < unassigned.length; i += MAX_ARTICLES_PER_SECTION) {
      groups.push({
        topic: groups.length > 0 ? "その他の話題" : "ニュース",
        articleIds: unassigned.slice(i, i + MAX_ARTICLES_PER_SECTION),
      })
    }

    return groups
  }

  private async generateSection(
    input: {
      readonly jobId: string
      readonly ownerId: string
      readonly feedIds: readonly string[]
      readonly signal?: AbortSignal
    },
    group: TopicGroup
  ): Promise<{ title: string; script: string; sourceUrls: readonly URL[] }> {
    const draft = await this.singleAgent.run({
      jobId: input.jobId,
      ownerId: input.ownerId,
      feedIds: input.feedIds,
      articleIds: group.articleIds,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    })
    return {
      title: draft.title,
      script: draft.script,
      sourceUrls: draft.sourceUrls,
    }
  }

  private async mergeSections(
    sections: readonly SectionDraft[],
    input: {
      readonly jobId: string
      readonly signal?: AbortSignal
    }
  ): Promise<EpisodeScriptDraft> {
    if (sections.length === 0) {
      throw new Error("No sections generated")
    }
    if (sections.length === 1) {
      const s = sections[0]!
      return {
        title: s.title,
        script: s.script,
        sourceUrls: s.sourceUrls,
      }
    }

    const sectionText = sections
      .map(
        (s, i) =>
          `### セクション${i + 1}: ${s.topic}\nタイトル: ${s.title}\n\n${s.script}`
      )
      .join("\n\n---\n\n")

    const prompt = [
      "以下は各トピックのセクション原稿だ。1つの連続したPodcast番組にまとめよ。",
      "冒頭で今日のトピック全体を紹介し、セクション間に「次の話題は〜」の自然なつなぎを入れよ。",
      "同じ情報の重複は排除せよ。全体のタイトルも設定せよ。",
      "前置き・免責事項・定型文は一切省け。句読点は読み上げて自然な位置にだけ打て。",
      "",
      sectionText,
    ].join("\n")

    const merged = parseStructuredOutput(
      MergedDraftResponse,
      await this.callOpenAi(prompt, MERGED_DRAFT_FORMAT, input.signal)
    )

    const allSourceUrls = new Map<string, URL>()
    for (const section of sections) {
      for (const url of section.sourceUrls) {
        allSourceUrls.set(url.href, url)
      }
    }
    return {
      title: merged.title,
      script: merged.script,
      sourceUrls: [...allSourceUrls.values()],
    }
  }

  private async callOpenAi(
    prompt: string,
    format: typeof TOPIC_GROUPS_FORMAT | typeof MERGED_DRAFT_FORMAT,
    signal?: AbortSignal
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: this.config.model,
          instructions: "簡潔なJSONだけを出力せよ。説明や前置きは一切不要。",
          input: prompt,
          text: { format },
        }),
      })
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      throw new PodcastAgentError(
        `OpenAI request failed: ${error instanceof Error ? error.message : "Unknown transport error"}`
      )
    }

    if (!response.ok) {
      throw new PodcastAgentError(
        `OpenAI request failed with ${response.status}: ${await readOpenAiError(response)}`,
        isRetryableProviderStatus(response.status)
      )
    }

    let data: {
      status?: string
      incomplete_details?: { reason?: string }
      output?: readonly {
        type?: string
        content?: readonly { type?: string; text?: string; refusal?: string }[]
      }[]
    }
    try {
      data = (await response.json()) as typeof data
    } catch {
      throw new PodcastAgentError("OpenAI returned a malformed response body")
    }
    const outputText = data.output
      ?.flatMap((item) => item.content ?? [])
      .find(
        (content) =>
          content.type === "output_text" && typeof content.text === "string"
      )?.text
    if (!outputText) {
      const refusal = data.output
        ?.flatMap((item) => item.content ?? [])
        .find((content) => content.type === "refusal")?.refusal
      if (refusal) {
        throw new PodcastAgentError("OpenAI refused structured output", false)
      }
      const reason = data.incomplete_details?.reason ?? data.status ?? "unknown"
      throw new PodcastAgentError(
        `OpenAI response contained no output text (${reason})`
      )
    }
    try {
      return JSON.parse(outputText)
    } catch {
      throw new PodcastAgentError("OpenAI returned malformed structured output")
    }
  }
}

function parseStructuredOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new PodcastAgentError(
      "OpenAI structured output did not satisfy the application contract"
    )
  }
  return result.data
}
