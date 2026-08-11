import type { LocalStore } from "@news-podcast/adapters/db/local"

/** アーカイブ済み記事にのみ archiveUrl/markdownUrl を付与する。 */
export function articleResponse(
  article: ReturnType<LocalStore["listArticles"]>["items"][number]
) {
  return {
    ...article,
    ...(article.snapshotId
      ? {
          archiveUrl: `/v1/me/articles/${article.id}/archive`,
          markdownUrl: `/v1/me/articles/${article.id}/markdown`,
        }
      : {}),
  }
}
