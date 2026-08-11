import type { components } from "@news-podcast/contracts/openapi"

export type Article = components["schemas"]["Article"]

/** 一覧・グループ化・並び替えの基準時刻。公開日時が無ければ発見日時を使う。 */
export function articleTimestamp(article: Article): string {
  return article.publishedAt ?? article.discoveredAt
}

export function publishedAtLabel(publishedAt: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(publishedAt))
}
