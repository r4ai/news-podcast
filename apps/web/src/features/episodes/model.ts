import type { components } from "@news-podcast/contracts/openapi"

export type Episode = components["schemas"]["Episode"]
export type EpisodePage = components["schemas"]["EpisodePage"]

/** 一覧とダッシュボードで同じ書式を使うための表示モデル。 */
export function episodeSubtitle(episode: {
  readonly createdAt: string
  readonly sources: readonly unknown[]
}): string {
  const createdAt = new Date(episode.createdAt).toLocaleString("ja-JP")
  return `${createdAt} ・ 出典${episode.sources.length}件`
}
