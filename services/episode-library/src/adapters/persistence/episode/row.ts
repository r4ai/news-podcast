import type { CompletedEpisode } from "../../../domain/episode.js"
import { parseCompletedEpisode } from "../../parse-stored-episode.js"

export type EpisodeRow = Readonly<{
  id: string
  ownerId: string
  title: string
  script: string
  audioObjectKey: string
  audioByteLength: number
  audioContentType: string
  createdAt: string
}>

export type EpisodeSourceRow = Readonly<{
  episodeId: string
  sourceKind: string
  url: string
  title: string
  publishedAt: string | null
  snapshotId: string | null
}>

/**
 * NULL列は「キーが無い」形へ畳む。ドメインのSchemaは欠損を
 * `optionalKey`で表現しており、明示的なnullを受け付けない。
 */
const toSourceInput = (source: EpisodeSourceRow) => ({
  sourceKind: source.sourceKind,
  url: source.url,
  title: source.title,
  ...(source.publishedAt === null ? {} : { publishedAt: source.publishedAt }),
  ...(source.snapshotId === null ? {} : { snapshotId: source.snapshotId }),
})

export const groupSourcesByEpisode = (
  sources: readonly EpisodeSourceRow[]
): ReadonlyMap<string, readonly ReturnType<typeof toSourceInput>[]> => {
  const grouped = new Map<string, ReturnType<typeof toSourceInput>[]>()
  for (const source of sources) {
    const existing = grouped.get(source.episodeId)
    if (existing === undefined) {
      grouped.set(source.episodeId, [toSourceInput(source)])
      continue
    }
    existing.push(toSourceInput(source))
  }
  return grouped
}

/** 永続化層の出力を、唯一の妥当な完成状態へ変換する。 */
export const decodeEpisode = (
  row: EpisodeRow,
  sources: readonly ReturnType<typeof toSourceInput>[]
): ReturnType<typeof parseCompletedEpisode> =>
  parseCompletedEpisode({
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    script: row.script,
    audioObjectKey: row.audioObjectKey,
    audioByteLength: row.audioByteLength,
    audioContentType: row.audioContentType,
    createdAt: row.createdAt,
    sources,
  })

export type { CompletedEpisode }
