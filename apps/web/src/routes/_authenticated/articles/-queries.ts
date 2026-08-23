import {
  infiniteQueryOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query"

import { api, fetchClient } from "@/shared/api"
import {
  applyFacetsDelta,
  replaceArticleInPages,
  toFacetsQuery,
  toListQuery,
  type Article,
  type ArticleFacets,
  type ArticleFlags,
  type ArticlePage,
  type ArticlesSearch,
} from "./-model"

export const PAGE_SIZE = 50

/**
 * 一覧のqueryKey接頭辞。`api.queryOptions`が作る`["get", path, init]`と
 * 揃えることで、既存の`invalidateQueries({queryKey: ARTICLES_QUERY_KEY})`が
 * そのまま効く。
 */
export const ARTICLES_QUERY_KEY = ["get", "/v1/me/articles"] as const
export const ARTICLE_FACETS_QUERY_KEY = [
  "get",
  "/v1/me/articles/facets",
] as const
export const ARTICLE_QUERY_KEY = ["get", "/v1/me/articles/{articleId}"] as const

type ArticleListInit = {
  readonly params: {
    readonly query: ReturnType<typeof toListQuery> & {
      readonly limit: string
    }
  }
}

function listInit(search: ArticlesSearch): ArticleListInit {
  return {
    params: { query: { ...toListQuery(search), limit: String(PAGE_SIZE) } },
  }
}

/**
 * 一覧の無限クエリ。`cursor`は先頭ページで送らないので、
 * `openapi-react-query`のpageParam既定値(`0`)が混入する経路を避け、
 * queryFnを自前で持つ。routeのloaderからも同じ定義を先読みできる。
 */
export function articlesInfiniteQueryOptions(search: ArticlesSearch) {
  const init = listInit(search)
  return infiniteQueryOptions({
    queryKey: [...ARTICLES_QUERY_KEY, init] as const,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await fetchClient.GET("/v1/me/articles", {
        signal,
        params: {
          query: {
            ...init.params.query,
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
          },
        },
      })
      if (error) throw error
      return data as ArticlePage
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ArticlePage) =>
      last.page.hasMore ? last.page.nextCursor : undefined,
  })
}

export function articleFacetsQueryOptions(search: ArticlesSearch) {
  return api.queryOptions("get", "/v1/me/articles/facets", {
    params: { query: toFacetsQuery(search) },
  })
}

export function articleQueryOptions(articleId: string, snapshotId?: string) {
  return queryOptions({
    queryKey: ["article", articleId, snapshotId ?? "latest"] as const,
    queryFn: async ({ signal }): Promise<Article> => {
      const response =
        snapshotId === undefined
          ? await fetchClient.GET("/v1/me/articles/{articleId}", {
              signal,
              params: { path: { articleId } },
            })
          : await fetchClient.GET(
              "/v1/me/articles/{articleId}/snapshots/{snapshotId}",
              { signal, params: { path: { articleId, snapshotId } } }
            )
      if (response.error) throw response.error
      return response.data as Article
    },
  })
}

/**
 * 本文Markdownは記事ごとに不変なので、切り替えで取り直さないよう長めに保つ。
 *
 * 応答は`text/markdown`ではなく`application/json`の`{ markdown }`。
 * `parseAs: "text"`にすると本文の代わりにJSONのソース文字列を受け取り、
 * それがそのままMarkdownとして描画されてしまう。
 */
export function articleMarkdownQueryOptions(
  articleId: string,
  snapshotId?: string
) {
  return queryOptions({
    queryKey: ["article-markdown", articleId, snapshotId ?? "latest"] as const,
    queryFn: async ({ signal }) => {
      const { data, error } =
        snapshotId === undefined
          ? await fetchClient.GET("/v1/me/articles/{articleId}/markdown", {
              signal,
              params: { path: { articleId } },
            })
          : await fetchClient.GET(
              "/v1/me/articles/{articleId}/snapshots/{snapshotId}/markdown",
              { signal, params: { path: { articleId, snapshotId } } }
            )
      if (error) throw error
      return data?.markdown ?? ""
    },
    staleTime: 5 * 60_000,
  })
}

export function articleReplayQueryOptions(snapshotId: string) {
  return queryOptions({
    queryKey: ["article-replay", snapshotId] as const,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/v1/me/article-snapshots/${snapshotId}/replay`,
        { signal }
      )
      if (!response.ok) throw new Error("article replay unavailable")
      const body = (await response.json()) as { readonly url?: unknown }
      if (typeof body.url !== "string" || !body.url.startsWith("/v1/me/")) {
        throw new Error("invalid article replay response")
      }
      return body.url
    },
    retry: false,
    staleTime: 5 * 60_000,
  })
}

/**
 * 記事状態の更新を投入順へ直列化するmutation scope。
 *
 * 楽観的UIでは、同じ対象への連打が並行すると「最後に投げた要求」と
 * 「最後に返った応答」が一致せず、サーバ応答でUIが巻き戻る。同じscopeを
 * 持つmutationはTanStack Queryが直列に実行するので、最終状態は常に
 * 最後の操作と一致する。一覧と本文で同じscopeを共有し、両方から同じ記事を
 * 操作した場合も直列になるようにする。
 */
export const ARTICLE_STATE_MUTATION_SCOPE = { id: "article-state" } as const

/**
 * 1件更新の結果をキャッシュへ直接畳み込む。
 *
 * 状態トグルのたびに一覧とfacetsを`invalidateQueries`すると、ブックマーク
 * 1クリックで全件が再取得される。サーバ応答は更新後の記事そのものなので、
 * 該当行とfacetsの差分だけを書き戻せば再取得は要らない。
 */
export function writeArticleToCaches(
  queryClient: QueryClient,
  input: {
    readonly article: Article
    readonly before: ArticleFlags
    readonly includeHidden: boolean
  }
): void {
  const { article, before, includeHidden } = input
  // 非表示にした記事は、非表示を含めない絞り込みからは消える。
  const drop = article.hidden && !includeHidden

  queryClient.setQueryData(articleQueryOptions(article.id).queryKey, article)
  // 記事状態はsnapshot間で共有する。固定版のmetadataは不変のまま、同じ記事の
  // detail cacheすべてへ現在の状態だけを反映し、mutation完了後の巻き戻りを防ぐ。
  queryClient.setQueriesData<Article>(
    { queryKey: ["article", article.id] },
    (cached) =>
      cached === undefined
        ? cached
        : {
            ...cached,
            read: article.read,
            saved: article.saved,
            readLater: article.readLater,
            hidden: article.hidden,
            hiddenAt: article.hiddenAt,
          }
  )

  queryClient.setQueriesData<{
    pages: readonly ArticlePage[]
    pageParams: readonly unknown[]
  }>({ queryKey: ARTICLES_QUERY_KEY }, (data) =>
    data
      ? { ...data, pages: replaceArticleInPages(data.pages, article, { drop }) }
      : data
  )

  queryClient.setQueriesData<ArticleFacets>(
    { queryKey: ARTICLE_FACETS_QUERY_KEY },
    (facets) =>
      applyFacetsDelta(facets, {
        feedId: article.feedId,
        includeHidden,
        before,
        after: article,
      })
  )
}

/** 一括更新のように差分を数え切れない操作だけ、一覧とfacetsを取り直す。 */
export async function refetchArticleCollections(
  queryClient: QueryClient
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ARTICLES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ARTICLE_FACETS_QUERY_KEY }),
  ])
}
