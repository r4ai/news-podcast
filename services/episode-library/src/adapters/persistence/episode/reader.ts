import { and, asc, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm"

import { episodes, episodeSources } from "../../../../drizzle/schema.js"
import type {
  EpisodePagePosition,
  EpisodePageQuery,
} from "../../../application/ports/episode-library.js"
import type { EpisodeId, OwnerId } from "../../../domain/episode.js"
import type { EpisodeLibraryDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"
import {
  groupSourcesByEpisode,
  type EpisodeRow,
  type EpisodeSourceRow,
} from "./row.js"

const episodeProjection = {
  id: episodes.id,
  ownerId: episodes.ownerId,
  title: episodes.title,
  script: episodes.script,
  audioObjectKey: episodes.audioObjectKey,
  audioByteLength: episodes.audioByteLength,
  audioContentType: episodes.audioContentType,
  createdAt: episodes.createdAt,
}

/**
 * (created_at, id) の降順キーセット。境界行を取りこぼさないよう、
 * 同一 created_at では id で決着をつける。
 */
export const keysetFilter = (after: EpisodePagePosition): SQL =>
  or(
    lt(episodes.createdAt, after.createdAt),
    and(
      eq(episodes.createdAt, after.createdAt),
      lt(episodes.id, after.episodeId)
    )
  ) as SQL

export const selectEpisodePage = (
  database: EpisodeLibraryDatabase,
  ownerId: OwnerId,
  query: EpisodePageQuery
): readonly EpisodeRow[] =>
  database
    .select(episodeProjection)
    .from(episodes)
    .where(
      query.after === undefined
        ? eq(episodes.ownerId, ownerId)
        : and(eq(episodes.ownerId, ownerId), keysetFilter(query.after))
    )
    .orderBy(desc(episodes.createdAt), desc(episodes.id))
    .limit(query.limit)
    .all()

export const selectEpisode = (
  database: EpisodeLibraryDatabase,
  ownerId: OwnerId,
  episodeId: EpisodeId
): EpisodeRow | undefined =>
  database
    .select(episodeProjection)
    .from(episodes)
    .where(and(eq(episodes.ownerId, ownerId), eq(episodes.id, episodeId)))
    .get()

/**
 * 出典はエピソードごとに引かず、1クエリでまとめて読む。
 * 以前はエピソード数に比例してクエリが増えていた（N+1）。
 */
export const selectSourcesFor = (
  database: EpisodeLibraryDatabase,
  episodeIds: readonly string[]
): ReadonlyMap<string, readonly unknown[]> => {
  if (episodeIds.length === 0) return new Map()

  const rows = database
    .select({
      episodeId: episodeSources.episodeId,
      sourceKind: episodeSources.sourceKind,
      url: episodeSources.url,
      title: episodeSources.title,
      publishedAt: episodeSources.publishedAt,
      snapshotId: episodeSources.snapshotId,
    })
    .from(episodeSources)
    .where(inArray(episodeSources.episodeId, [...episodeIds]))
    .orderBy(asc(episodeSources.episodeId), asc(episodeSources.position))
    .all()

  return groupSourcesByEpisode(rows as readonly EpisodeSourceRow[])
}
