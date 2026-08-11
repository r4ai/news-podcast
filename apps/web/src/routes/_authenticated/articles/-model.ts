import type { components } from "@news-podcast/contracts/openapi"

import {
  articleTimestamp,
  publishedAtLabel,
  type Article,
} from "@/features/articles"

export type { Article }
export type ArticleFacets = components["schemas"]["ArticleFacets"]
export type Tag = components["schemas"]["Tag"]
export type TagSuggestion = components["schemas"]["TagSuggestion"]

export type ArticleState = "all" | "unread" | "saved" | "later"
export type ArticleSort = "newest" | "oldest" | "source" | "relevance"
/** サーバのAPIには存在しないクライアント側だけの絞り込み軸。取得済みの記事にのみ適用する。 */
export type ArticlePeriod = "all" | "today" | "week" | "month"
export type ArticleStatusFilter = "all" | Article["archiveStatus"]

export type ArticlesSearch = {
  readonly state: ArticleState
  readonly sort: ArticleSort
  readonly q: string
  readonly feedIds: readonly string[]
  readonly includeHidden: boolean
  readonly usedInEpisode: boolean
  readonly period: ArticlePeriod
  readonly archiveStatusFilter: ArticleStatusFilter
  /** タグID（OR条件）。 */
  readonly tagIds: readonly string[]
  /** 選択中の記事ID。URLが唯一の情報源で、リーダーの開閉もこれで表す。 */
  readonly article: string | undefined
}

export const defaultArticlesSearch: ArticlesSearch = {
  state: "unread",
  sort: "newest",
  q: "",
  feedIds: [],
  includeHidden: false,
  usedInEpisode: false,
  period: "all",
  archiveStatusFilter: "all",
  tagIds: [],
  article: undefined,
}

const states: readonly ArticleState[] = ["all", "unread", "saved", "later"]
const sorts: readonly ArticleSort[] = [
  "newest",
  "oldest",
  "source",
  "relevance",
]
const periods: readonly ArticlePeriod[] = ["all", "today", "week", "month"]
const archiveStatuses: readonly ArticleStatusFilter[] = [
  "all",
  "pending",
  "archiving",
  "succeeded",
  "failed",
]

function oneOf<T extends string>(
  candidates: readonly T[],
  value: unknown,
  fallback: T
): T {
  return candidates.includes(value as T) ? (value as T) : fallback
}

function toStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string")
  }
  return typeof value === "string" && value.length > 0 ? [value] : []
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value === "true" || value === true) return true
  if (value === "false" || value === false) return false
  return fallback
}

/** TanStack Routerの`validateSearch`。URLが唯一の絞り込み状態の情報源になる。 */
export function validateArticlesSearch(
  search: Record<string, unknown>
): ArticlesSearch {
  return {
    state: oneOf(states, search.state, defaultArticlesSearch.state),
    sort: oneOf(sorts, search.sort, defaultArticlesSearch.sort),
    q: typeof search.q === "string" ? search.q : defaultArticlesSearch.q,
    feedIds: toStringArray(search.feedIds),
    includeHidden: toBoolean(
      search.includeHidden,
      defaultArticlesSearch.includeHidden
    ),
    usedInEpisode: toBoolean(
      search.usedInEpisode,
      defaultArticlesSearch.usedInEpisode
    ),
    period: oneOf(periods, search.period, defaultArticlesSearch.period),
    archiveStatusFilter: oneOf(
      archiveStatuses,
      search.archiveStatusFilter,
      defaultArticlesSearch.archiveStatusFilter
    ),
    tagIds: toStringArray(search.tagIds),
    article:
      typeof search.article === "string" && search.article.length > 0
        ? search.article
        : undefined,
  }
}

export const stateTabs: readonly { value: ArticleState; label: string }[] = [
  { value: "unread", label: "未読" },
  { value: "later", label: "あとで" },
  { value: "saved", label: "保存" },
  { value: "all", label: "すべて" },
]

export const sortOptions: readonly { value: ArticleSort; label: string }[] = [
  { value: "newest", label: "新着順" },
  { value: "oldest", label: "古い順" },
  { value: "source", label: "媒体ごと" },
  { value: "relevance", label: "おすすめ順" },
]

export const periodOptions: readonly { value: ArticlePeriod; label: string }[] =
  [
    { value: "all", label: "すべての期間" },
    { value: "today", label: "今日" },
    { value: "week", label: "今週" },
    { value: "month", label: "今月" },
  ]

const archiveLabels = {
  pending: "保存待ち",
  archiving: "保存中",
  succeeded: "保存済み",
  failed: "保存失敗",
} satisfies Record<Article["archiveStatus"], string>

export function archiveLabel(status: Article["archiveStatus"]): string {
  return archiveLabels[status]
}

export function isArchived(status: Article["archiveStatus"]): boolean {
  return status === "succeeded"
}

/** 一覧行のmeta表示用。succeededと(現状の仕様では)archivingは静かに隠す。 */
export function archiveMetaLabel(
  status: Article["archiveStatus"]
): string | null {
  return status === "pending" || status === "failed"
    ? archiveLabel(status)
    : null
}

export { articleTimestamp, publishedAtLabel }

export type DateGroupKey = "today" | "yesterday" | "thisWeek" | "older"

const dateGroupLabels: Record<DateGroupKey, string> = {
  today: "今日",
  yesterday: "昨日",
  thisWeek: "今週",
  older: "それ以前",
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function dateGroupKey(
  iso: string,
  now: Date = new Date()
): DateGroupKey {
  const diffDays = Math.round(
    (startOfDay(now) - startOfDay(new Date(iso))) / (24 * 60 * 60 * 1000)
  )
  if (diffDays <= 0) return "today"
  if (diffDays === 1) return "yesterday"
  if (diffDays <= 7) return "thisWeek"
  return "older"
}

export type ArticleGroup = {
  readonly key: DateGroupKey
  readonly label: string
  readonly articles: readonly Article[]
}

/** 連続する同一グループをまとめる。APIが日時順で返す前提なので単純な走査で足りる。 */
export function groupArticlesByDate(
  articles: readonly Article[],
  now: Date = new Date()
): readonly ArticleGroup[] {
  const groups: ArticleGroup[] = []
  for (const article of articles) {
    const key = dateGroupKey(articleTimestamp(article), now)
    const last = groups.at(-1)
    if (last && last.key === key) {
      groups[groups.length - 1] = {
        ...last,
        articles: [...last.articles, article],
      }
    } else {
      groups.push({ key, label: dateGroupLabels[key], articles: [article] })
    }
  }
  return groups
}

const periodDays: Record<Exclude<ArticlePeriod, "all">, number> = {
  today: 1,
  week: 7,
  month: 31,
}

/** 期間・アーカイブ状態はAPIに絞り込みパラメータが無いため、取得済み記事へクライアント側で適用する。 */
export function applyClientFilters(
  articles: readonly Article[],
  filters: Pick<ArticlesSearch, "period" | "archiveStatusFilter">,
  now: Date = new Date()
): readonly Article[] {
  return articles.filter((article) => {
    if (
      filters.archiveStatusFilter !== "all" &&
      article.archiveStatus !== filters.archiveStatusFilter
    ) {
      return false
    }
    if (filters.period === "all") return true
    const diffDays =
      (now.getTime() - new Date(articleTimestamp(article)).getTime()) /
      (24 * 60 * 60 * 1000)
    return diffDays <= periodDays[filters.period]
  })
}

/** `/v1/me/articles`へ渡すクエリ。クライアント専用の軸(period/archiveStatusFilter)は含めない。 */
export function toListQuery(search: ArticlesSearch) {
  return {
    q: search.q.trim() || undefined,
    state: search.state,
    feedIds: search.feedIds.length > 0 ? [...search.feedIds] : undefined,
    sort: search.sort,
    includeHidden: search.includeHidden ? "true" : undefined,
    usedInEpisode: search.usedInEpisode ? "true" : undefined,
    tagIds: search.tagIds.length > 0 ? [...search.tagIds] : undefined,
  } as const
}

/** `/v1/me/articles/facets`へ渡すクエリ。 */
export function toFacetsQuery(search: ArticlesSearch) {
  return {
    q: search.q.trim() || undefined,
    feedIds: search.feedIds.length > 0 ? [...search.feedIds] : undefined,
    includeHidden: search.includeHidden ? "true" : undefined,
    tagIds: search.tagIds.length > 0 ? [...search.tagIds] : undefined,
  } as const
}

/** 「すべて既読」など一括操作のfilterボディ。 */
export function toBulkFilter(search: ArticlesSearch) {
  return {
    q: search.q.trim() || undefined,
    state: search.state,
    feedIds: search.feedIds.length > 0 ? [...search.feedIds] : undefined,
    includeHidden: search.includeHidden,
  } as const
}

// --- リーダー ---------------------------------------------------------

export type ArticleSource = "markdown" | "archive"

/**
 * Markdown内の相対URL(assets/{hash}など)を解決する起点。
 * `Markdown`側の解決は`new URL(src, baseUrl)`を使うため、オリジンを
 * 含む絶対URLで渡す必要がある。
 */
export function articleBaseUrl(
  articleId: string,
  origin: string = window.location.origin
): string {
  return `${origin}/v1/me/articles/${articleId}/`
}

/** 本文が無い/取得失敗/極端に短い場合は自動でアーカイブへ切り替える閾値。 */
export const MARKDOWN_FALLBACK_MIN_LENGTH = 80

/** Markdown取得の状態から、アーカイブへ自動フォールバックすべきかを判定する。 */
export function shouldFallbackToArchive(params: {
  readonly markdown: string | undefined
  readonly isError: boolean
}): boolean {
  if (params.isError) return true
  const trimmed = params.markdown?.trim() ?? ""
  return trimmed.length < MARKDOWN_FALLBACK_MIN_LENGTH
}

/** AI要約ブロックを出すかどうか。関連度の成否とは独立に判定する。 */
export function hasAiEnrichment(
  article: Pick<Article, "aiSummary" | "relevanceScore">
): boolean {
  return (
    typeof article.aiSummary === "string" && article.aiSummary.trim().length > 0
  )
}

// 一覧行のスニペット用に、Markdownから最初の見出し・結論行を平文として抽出する。
// 見出しラベル（例: `## 結論`）やMermaid図、```コードブロック```は飛ばし、
// 本文の最初の行を取り200文字に切る。
export function aiSummarySnippet(markdown: string): string {
  let inCodeBlock = false
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim()
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock || line.length === 0 || line.startsWith("#")) continue
    const stripped = line
      .replace(/^[-*+]\s+/, "")
      .replace(/[*_>]/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim()
    if (stripped.length === 0) continue
    return stripped.slice(0, 200)
  }
  return ""
}

/** 一覧行のスニペット。AI要約の冒頭を優先し、未処理ならRSSのsummaryへフォールバックする。 */
export function articleSnippet(
  article: Pick<Article, "aiSummary" | "summary">
): string | undefined {
  if (typeof article.aiSummary === "string" && article.aiSummary.length > 0) {
    return aiSummarySnippet(article.aiSummary)
  }
  return article.summary
}

/** おすすめ順のときだけ行にスコアを数値表示する。他の並び順では出さない。 */
export function shouldShowRelevanceScore(sort: ArticleSort): boolean {
  return sort === "relevance"
}

/** j/kキー送り用に、現在の記事から前後の記事IDを求める。 */
export function siblingArticleId(
  articles: readonly Article[],
  currentId: string | undefined,
  direction: 1 | -1
): string | undefined {
  if (articles.length === 0) return undefined
  const index = articles.findIndex((article) => article.id === currentId)
  if (index === -1) return articles[0]?.id
  const nextIndex = index + direction
  return articles[nextIndex]?.id
}
