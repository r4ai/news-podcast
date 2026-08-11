import type {
  AgentArticle,
  EpisodeScriptDraft,
  PodcastAgentContext,
  PodcastAgentRunner,
} from "@news-podcast/application"
import type { OpenAiConfig } from "./config.js"
import { OpenAiPodcastAgent, type AgentAudit } from "./openai-podcast-agent.js"

const MIN_ARTICLES_FOR_SECTIONAL = 6
const MAX_ARTICLES_PER_SECTION = 6

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
    private readonly fetcher: typeof fetch = fetch,
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
    signal?: AbortSignal,
  ): Promise<readonly TopicGroup[]> {
    const articleList = articles
      .map(
        (a, i) =>
          `${i + 1}. [${a.id}] ${a.title}（${a.sourceName}）${a.summary ? `\n   概要: ${a.summary}` : ""}`,
      )
      .join("\n")

    const prompt = [
      "以下の記事一覧を、共通の話題でグループ分けせよ。",
      `1グループ最大${MAX_ARTICLES_PER_SECTION}記事、各記事は1グループのみ所属。`,
      "JSON形式で出力せよ。",
      "",
      "出力形式:",
      '[ { "topic": "グループ名", "articleIds": ["uuid1", "uuid2"] }, ... ]',
      "",
      "記事一覧:",
      articleList,
    ].join("\n")

    const result = await this.callOpenAi(prompt, signal)
    const parsed = parseTopicGroups(result)

    const assigned = new Set<string>()
    for (const group of parsed) {
      for (const id of group.articleIds) {
        if (assigned.has(id)) continue
        if (!articles.some((a) => a.id === id)) continue
        assigned.add(id)
      }
    }

    const unassigned = articles
      .filter((a) => !assigned.has(a.id))
      .map((a) => a.id)
    if (unassigned.length > 0) {
      if (parsed.length > 0) {
        return [
          ...parsed.filter((g) =>
            g.articleIds.some((id) => articles.some((a) => a.id === id)),
          ),
          { topic: "その他の話題", articleIds: unassigned },
        ]
      }
      for (
        let i = 0;
        i < unassigned.length;
        i += MAX_ARTICLES_PER_SECTION
      ) {
        parsed.push({
          topic: "ニュース",
          articleIds: unassigned.slice(i, i + MAX_ARTICLES_PER_SECTION),
        })
      }
    }

    return parsed.filter((g) => g.articleIds.length > 0)
  }

  private async generateSection(
    input: {
      readonly jobId: string
      readonly ownerId: string
      readonly feedIds: readonly string[]
      readonly signal?: AbortSignal
    },
    group: TopicGroup,
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
    },
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
          `### セクション${i + 1}: ${s.topic}\nタイトル: ${s.title}\n\n${s.script}`,
      )
      .join("\n\n---\n\n")

    const prompt = [
      "以下は各トピックのセクション原稿だ。1つの連続したPodcast番組にまとめよ。",
      "冒頭で今日のトピック全体を紹介し、セクション間に「次の話題は〜」の自然なつなぎを入れよ。",
      "同じ情報の重複は排除せよ。全体のタイトルも設定せよ。",
      "前置き・免責事項・定型文は一切省け。句読点は読み上げて自然な位置にだけ打て。",
      "",
      "JSON形式で出力せよ:",
      '{ "title": "全体タイトル", "script": "統合台本", "source_urls": ["url1", ...] }',
      "",
      sectionText,
    ].join("\n")

    const result = await this.callOpenAi(prompt, input.signal)
    const merged = parseMergedDraft(result)

    const allSourceUrls = new Map<string, URL>()
    for (const section of sections) {
      for (const url of section.sourceUrls) {
        allSourceUrls.set(url.href, url)
      }
    }
    for (const url of merged.sourceUrls) {
      allSourceUrls.set(url.href, url)
    }

    return {
      title: merged.title,
      script: merged.script,
      sourceUrls: [...allSourceUrls.values()],
    }
  }

  private async callOpenAi(
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.fetcher(
      "https://api.openai.com/v1/responses",
      {
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
          instructions:
            "簡潔なJSONだけを出力せよ。説明や前置きは一切不要。",
          input: prompt,
        }),
      },
    )

    if (!response.ok) {
      throw new Error(
        `OpenAI request failed with ${response.status}: ${response.statusText}`,
      )
    }

    const data = (await response.json()) as {
      output?: readonly { content?: readonly { text?: string }[] }[]
    }
    const output = data.output?.[0]
    const content = output?.content?.[0]?.text
    if (!content) {
      throw new Error("OpenAI returned empty response")
    }
    return content
  }
}

function parseTopicGroups(
  raw: string,
): { topic: string; articleIds: string[] }[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      const obj = item as Record<string, unknown>
      return {
        topic: String(obj.topic ?? "ニュース"),
        articleIds: Array.isArray(obj.articleIds)
          ? obj.articleIds.map(String)
          : [],
      }
    })
  } catch {
    return []
  }
}

function parseMergedDraft(raw: string): {
  title: string
  script: string
  sourceUrls: URL[]
} {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("Failed to parse merged draft")
  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  return {
    title: String(parsed.title ?? ""),
    script: String(parsed.script ?? ""),
    sourceUrls: Array.isArray(parsed.source_urls)
      ? parsed.source_urls.map((u: unknown) => new URL(String(u)))
      : [],
  }
}
