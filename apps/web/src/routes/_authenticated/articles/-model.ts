import type { components } from "@news-podcast/contracts/openapi"

import {
  articleTimestamp,
  publishedAtLabel,
  type Article,
} from "@/features/articles"
import {
  dateGroupKey,
  groupByDate,
  type DateGroupKey,
} from "@/shared/lib/date-group"

export type { Article }
export type ArticleFacets = components["schemas"]["ArticleFacets"]
export type Tag = components["schemas"]["Tag"]
export type TagSuggestion = components["schemas"]["TagSuggestion"]

export type ArticleState = "all" | "unread" | "saved" | "later"
export type ArticleSort = "newest" | "oldest"

export type ArticlesSearch = {
  readonly state: ArticleState
  readonly sort: ArticleSort
  readonly q: string
  readonly feedIds: readonly string[]
  readonly includeHidden: boolean
  /** 選択中の記事ID。URLが唯一の情報源で、リーダーの開閉もこれで表す。 */
  readonly article: string | undefined
  /** Episode出典から開く場合だけ指定する、生成時の固定snapshot。 */
  readonly snapshot: string | undefined
}

export const defaultArticlesSearch: ArticlesSearch = {
  state: "unread",
  sort: "newest",
  q: "",
  feedIds: [],
  includeHidden: false,
  article: undefined,
  snapshot: undefined,
}

const states: readonly ArticleState[] = ["all", "unread", "saved", "later"]
const sorts: readonly ArticleSort[] = ["newest", "oldest"]

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
  const article =
    typeof search.article === "string" && search.article.length > 0
      ? search.article
      : undefined
  return {
    state: oneOf(states, search.state, defaultArticlesSearch.state),
    sort: oneOf(sorts, search.sort, defaultArticlesSearch.sort),
    q: typeof search.q === "string" ? search.q : defaultArticlesSearch.q,
    feedIds: toStringArray(search.feedIds),
    includeHidden: toBoolean(
      search.includeHidden,
      defaultArticlesSearch.includeHidden
    ),
    article,
    snapshot:
      article !== undefined &&
      typeof search.snapshot === "string" &&
      search.snapshot.length > 0
        ? search.snapshot
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

export { dateGroupKey }
export type { DateGroupKey }

export type ArticleGroup = {
  readonly key: DateGroupKey
  readonly label: string
  readonly articles: readonly Article[]
}

/** 括り方は記事も番組も同じ (`shared/lib/date-group`)。ここは呼び名だけを合わせる。 */
export function groupArticlesByDate(
  articles: readonly Article[],
  now: Date = new Date()
): readonly ArticleGroup[] {
  return groupByDate(articles, articleTimestamp, now).map((group) => ({
    key: group.key,
    label: group.label,
    articles: group.items,
  }))
}

/** `/v1/me/articles`へ渡す、サーバが実際に適用できるクエリ。 */
export function toListQuery(search: ArticlesSearch) {
  return {
    q: search.q.trim() || undefined,
    state: search.state,
    feedIds: search.feedIds.length > 0 ? [...search.feedIds] : undefined,
    sort: search.sort,
    includeHidden: search.includeHidden ? "true" : undefined,
  } as const
}

/** `/v1/me/articles/facets`へ渡すクエリ。 */
export function toFacetsQuery(search: ArticlesSearch) {
  return {
    q: search.q.trim() || undefined,
    feedIds: search.feedIds.length > 0 ? [...search.feedIds] : undefined,
    includeHidden: search.includeHidden ? "true" : undefined,
  } as const
}

// --- 一覧キャッシュの差し替え ------------------------------------------

export type ArticlePage = {
  readonly items: readonly Article[]
  readonly page: { readonly hasMore: boolean; readonly nextCursor?: string }
}

/**
 * 取得済みページ群の中の1件だけを差し替える (`drop`なら取り除く)。
 * 変化しなかったページは同一参照で返し、React側の再レンダリング範囲を絞る。
 */
export function replaceArticleInPages<Page extends ArticlePage>(
  pages: readonly Page[],
  article: Article,
  options: { readonly drop?: boolean } = {}
): readonly Page[] {
  let changed = false
  const next = pages.map((page) => {
    if (!page.items.some((item) => item.id === article.id)) return page
    changed = true
    return {
      ...page,
      items: options.drop
        ? page.items.filter((item) => item.id !== article.id)
        : page.items.map((item) => (item.id === article.id ? article : item)),
    }
  })
  return changed ? next : pages
}

// --- facetsの差分更新 --------------------------------------------------
//
// 状態を1件更新するたびにfacetsを再取得すると、保存ボタン1回で一覧全体が
// 再フェッチされる。1件の遷移は前後のフラグから正確に差分を計算できるので、
// サーバへ問い合わせずにキャッシュを進める。

export type ArticleFlags = Pick<
  Article,
  "read" | "saved" | "readLater" | "hidden"
>

export type ArticleFacetsChange = {
  readonly feedId: string
  /** 現在の絞り込み。falseなら非表示記事はどの件数にも数えられない。 */
  readonly includeHidden: boolean
  readonly before: ArticleFlags
  readonly after: ArticleFlags
}

/** 絞り込みの母集合に入るか。facetsのすべての件数がこの判定に従属する。 */
function isCounted(flags: ArticleFlags, includeHidden: boolean): boolean {
  return includeHidden || !flags.hidden
}

function contribution(flags: ArticleFlags, includeHidden: boolean) {
  const counted = isCounted(flags, includeHidden)
  return {
    all: counted ? 1 : 0,
    unread: counted && !flags.read ? 1 : 0,
    saved: counted && flags.saved ? 1 : 0,
    later: counted && flags.readLater ? 1 : 0,
  }
}

const atLeastZero = (value: number) => (value < 0 ? 0 : value)

/**
 * 1件の状態遷移をfacetsへ反映する。
 * facetsに載っていない媒体の件数は動かさない (絞り込みの母集合外なので、
 * 次のfacets取得まで持ち越す)。`aiPending`は状態遷移と無関係なので保つ。
 */
export function applyFacetsDelta(
  facets: ArticleFacets | undefined,
  change: ArticleFacetsChange
): ArticleFacets | undefined {
  if (!facets) return facets
  const before = contribution(change.before, change.includeHidden)
  const after = contribution(change.after, change.includeHidden)
  const membershipDelta = after.all - before.all

  return {
    ...facets,
    states: {
      all: atLeastZero(facets.states.all + membershipDelta),
      unread: atLeastZero(facets.states.unread + after.unread - before.unread),
      saved: atLeastZero(facets.states.saved + after.saved - before.saved),
      later: atLeastZero(facets.states.later + after.later - before.later),
    },
    feeds:
      membershipDelta === 0
        ? facets.feeds
        : facets.feeds.map((feed) =>
            feed.feedId === change.feedId
              ? { ...feed, count: atLeastZero(feed.count + membershipDelta) }
              : feed
          ),
  }
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
  origin: string = window.location.origin,
  snapshotId?: string | null
): string {
  if (snapshotId != null) {
    return `${origin}/v1/me/article-snapshots/${snapshotId}/`
  }
  return `${origin}/v1/me/articles/${articleId}/`
}

/**
 * リーダー本文をコンパイルする際のオプション。
 *
 * 目次を本文の外(右レール)へ出すため、コンパイルはリーダー側で1度だけ行い、
 * 本文と目次の両方へ同じ結果を配る。オプションの組み立てをここに置くのは、
 * 本番とテストで同じ設定が使われることを保証するため。
 *
 * 見出しは`3`から始める。ページがh1(記事)、リーダーがh2(記事タイトル)を
 * 既に使っている。
 */
export function articleMarkdownOptions(
  article: Pick<Article, "id" | "title" | "snapshotId">
) {
  return {
    baseUrl: articleBaseUrl(
      article.id,
      window.location.origin,
      article.snapshotId
    ),
    headingBaseLevel: 3,
    omitLeadingTitle: article.title,
  } as const
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
