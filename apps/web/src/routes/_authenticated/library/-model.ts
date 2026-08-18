import type { components } from "@news-podcast/contracts/openapi"

import {
  episodeSubtitle,
  type Episode,
  type EpisodePage,
} from "@/features/episodes"
import { groupByDate, type DateGroupKey } from "@/shared/lib/date-group"

export type { Episode, EpisodePage }
export type EpisodeSource = components["schemas"]["EpisodeSource"]

/** 選択中の番組。URLが唯一の情報源で、詳細の開閉もこれで表す。 */
export type LibrarySearch = {
  readonly episode: string | undefined
}

export const defaultLibrarySearch: LibrarySearch = { episode: undefined }

export function validateLibrarySearch(
  search: Record<string, unknown>
): LibrarySearch {
  return {
    episode:
      typeof search.episode === "string" && search.episode.length > 0
        ? search.episode
        : undefined,
  }
}

export type EpisodeGroup = {
  readonly key: DateGroupKey
  readonly label: string
  readonly episodes: readonly Episode[]
}

export function groupEpisodesByDate(
  episodes: readonly Episode[],
  now: Date = new Date()
): readonly EpisodeGroup[] {
  return groupByDate(episodes, (episode) => episode.createdAt, now).map(
    (group) => ({
      key: group.key,
      label: group.label,
      episodes: group.items,
    })
  )
}

/**
 * 台本を段落へ割る。
 *
 * 生成される台本はMarkdownではなく読み上げ用の地の文で、改行の入り方は
 * providerの気分で変わる。空行区切りと改行区切りのどちらでも同じように
 * 割れるよう、連続する改行をまとめて1つの区切りとして扱う。
 */
export function scriptParagraphs(script: string): readonly string[] {
  return script
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}

/**
 * 台本の字数。読む量の目安なので、改行と空白は数えない。
 * `length`ではなくコードポイントで数える (絵文字が2字になる)。
 */
export function scriptLength(script: string): number {
  return Array.from(script.replace(/\s/g, "")).length
}

/** 一覧と詳細で同じ書式を使う。番組の素性は「いつ・何件・どれだけ」で足りる。 */
export function episodeMetaLabel(episode: Episode): string {
  return `${episodeSubtitle(episode)} ・ 台本${scriptLength(episode.script).toLocaleString("ja-JP")}字`
}

export function sourceKindLabel(
  kind: EpisodeSource["sourceKind"]
): string | undefined {
  if (kind === "rss") return "RSS"
  if (kind === "web") return "Web"
  return undefined
}

/**
 * j/kで送る先。端では留まる。行き止まりで選択が外れると、
 * 押した先が一覧の空白になり、操作が途切れる。
 */
export function siblingEpisodeId(
  episodes: readonly Episode[],
  currentId: string | undefined,
  step: 1 | -1
): string | undefined {
  if (episodes.length === 0) return undefined
  const index = episodes.findIndex((episode) => episode.id === currentId)
  if (index < 0) return (step === 1 ? episodes.at(0) : episodes.at(-1))?.id
  const next = Math.min(episodes.length - 1, Math.max(0, index + step))
  return episodes[next]?.id
}
