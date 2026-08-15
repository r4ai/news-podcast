import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  CompletionSaveResult,
  CompletionStoreFailure,
  EpisodeCompletionPorts,
} from "../../../application/ports/completion.js"
import type {
  CompletedEpisodeReader,
  EpisodeLibraryStorageFailure,
  EpisodePageQuery,
} from "../../../application/ports/episode-library.js"
import type { InboxMessageId } from "../../../domain/episode-completion.js"
import type {
  CompletedEpisode,
  EpisodeId,
  OwnerId,
  UtcInstant,
} from "../../../domain/episode.js"
import {
  openEpisodeLibraryDatabaseUnsafe,
  type EpisodeLibraryDatabaseHandle,
} from "../../../infrastructure/unsafe/drizzle/open.js"
import {
  backupDatabaseUnsafe,
  type EpisodeLibraryBackupFailure,
} from "../../../infrastructure/unsafe/sqlite/backup.js"
import { selectEpisode, selectEpisodePage, selectSourcesFor } from "./reader.js"
import { decodeEpisode, type EpisodeRow } from "./row.js"
import { saveEpisodeOnce } from "./writer.js"

export type EpisodeRepository = CompletedEpisodeReader &
  Pick<EpisodeCompletionPorts, "saveOnce"> & {
    readonly backupTo: (
      destinationPath: string
    ) => Effect.Effect<number, EpisodeLibraryBackupFailure>
    readonly close: Effect.Effect<void>
  }

const storageFailure = (
  operation: EpisodeLibraryStorageFailure["operation"]
): EpisodeLibraryStorageFailure =>
  deepFreeze({ _tag: "EpisodeLibraryStorageFailure", operation })

const decodeWithSources = (
  handle: EpisodeLibraryDatabaseHandle,
  rows: readonly EpisodeRow[]
) =>
  Effect.suspend(() => {
    const sources = selectSourcesFor(
      handle.database,
      rows.map((row) => row.id)
    )
    return Effect.forEach(rows, (row) =>
      decodeEpisode(
        row,
        (sources.get(row.id) ?? []) as Parameters<typeof decodeEpisode>[1]
      )
    )
  })

export const makeEpisodeRepository = (
  databasePath: string
): EpisodeRepository => {
  const handle = openEpisodeLibraryDatabaseUnsafe(databasePath)

  const saveOnce = (
    messageId: InboxMessageId,
    episode: CompletedEpisode,
    receivedAt: UtcInstant
  ): Effect.Effect<CompletionSaveResult, CompletionStoreFailure> =>
    Effect.try({
      try: () =>
        saveEpisodeOnce(handle.database, messageId, episode, receivedAt),
      catch: () =>
        deepFreeze({
          _tag: "CompletionStoreFailure" as const,
          operation: "save" as const,
        }),
    })

  const listPageByOwner = (
    ownerId: OwnerId,
    query: EpisodePageQuery
  ): Effect.Effect<readonly CompletedEpisode[], EpisodeLibraryStorageFailure> =>
    Effect.try(() => selectEpisodePage(handle.database, ownerId, query)).pipe(
      Effect.flatMap((rows) => decodeWithSources(handle, rows)),
      Effect.map(
        (episodes) => deepFreeze(episodes) as readonly CompletedEpisode[]
      ),
      Effect.mapError(() => storageFailure("list"))
    )

  const findByOwner = (
    ownerId: OwnerId,
    episodeId: EpisodeId
  ): Effect.Effect<
    CompletedEpisode | undefined,
    EpisodeLibraryStorageFailure
  > =>
    Effect.try(() => selectEpisode(handle.database, ownerId, episodeId)).pipe(
      Effect.flatMap((row) =>
        row === undefined
          ? Effect.succeed(undefined)
          : decodeWithSources(handle, [row]).pipe(
              Effect.map((decoded) => decoded[0])
            )
      ),
      Effect.mapError(() => storageFailure("find"))
    )

  return deepFreeze({
    saveOnce,
    listPageByOwner,
    findByOwner,
    backupTo: (destinationPath: string) =>
      backupDatabaseUnsafe(handle.client, destinationPath),
    close: Effect.sync(() => handle.close()),
  })
}
