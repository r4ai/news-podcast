import type { components } from "@news-podcast/contracts/openapi"

export type Article = components["schemas"]["Article"]

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

/** タイトルと媒体名の部分一致。検索語が空なら絞り込まない。 */
export function filterArticles(
  articles: readonly Article[],
  search: string
): readonly Article[] {
  const needle = search.trim().toLocaleLowerCase()
  if (!needle) return articles
  return articles.filter((article) =>
    `${article.title} ${article.sourceName}`
      .toLocaleLowerCase()
      .includes(needle)
  )
}

export function publishedAtLabel(publishedAt: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(publishedAt))
}
