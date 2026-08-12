import { deepFreeze, parse } from "@news-podcast/kernel"
import { Effect, Schema, Scope } from "effect"

import type {
  ReadingDictionaryRepository,
  ReadingDictionaryStoreError,
} from "../application/reading-dictionary.js"
import { UtcTimestampSchema } from "../domain/episode-job.js"
import {
  ReadingDictionaryEntrySchema,
  ReadingDictionarySnapshotSchema,
  type ReadingDictionaryEntry,
} from "../domain/reading-dictionary.js"
import {
  openUnsafeReadingDictionaryHandle,
  type ReadingDictionaryRow,
  type UnsafeReadingDictionaryHandle,
} from "../infrastructure/unsafe/sqlite-reading-dictionary.js"
import { dictionaryFingerprintUnsafe } from "../infrastructure/unsafe/dictionary-fingerprint.js"

const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)
const parseEntry = parse(ReadingDictionaryEntrySchema)

const failure = (
  operation: ReadingDictionaryStoreError["operation"],
  reason: ReadingDictionaryStoreError["reason"] = "Unavailable"
): ReadingDictionaryStoreError =>
  deepFreeze({ _tag: "ReadingDictionaryStoreFailed", operation, reason })

const decodeRow = (
  row: ReadingDictionaryRow,
  operation: ReadingDictionaryStoreError["operation"]
) =>
  parseEntry(row).pipe(
    Effect.map(deepFreeze),
    Effect.mapError(() => failure(operation, "CorruptRecord"))
  )

const toRow = (entry: ReadingDictionaryEntry): ReadingDictionaryRow => ({
  id: entry.id,
  ownerId: entry.ownerId,
  surface: entry.surface,
  reading: entry.reading,
  accentType: entry.accentType,
  source: entry.source,
  episodeJobId: entry.episodeJobId,
  createdAt: encodeTimestamp(entry.createdAt),
  updatedAt: encodeTimestamp(entry.updatedAt),
})

const sameCreation = (
  left: ReadingDictionaryEntry,
  right: ReadingDictionaryEntry
) =>
  left.ownerId === right.ownerId &&
  left.surface === right.surface &&
  left.reading === right.reading &&
  left.accentType === right.accentType &&
  left.source === right.source &&
  left.episodeJobId === right.episodeJobId

const repositoryFromHandle = (
  handle: UnsafeReadingDictionaryHandle
): ReadingDictionaryRepository => {
  const list: ReadingDictionaryRepository["list"] = (ownerId) =>
    Effect.try({
      try: () => handle.listOwned(ownerId),
      catch: () => failure("List"),
    }).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => decodeRow(row, "List"), {
          concurrency: 1,
        })
      ),
      Effect.map(deepFreeze)
    )

  const create: ReadingDictionaryRepository["create"] = (entry) =>
    Effect.gen(function* () {
      const { inserted, existing } = yield* Effect.try({
        try: () =>
          handle.transaction(() => {
            const existing = handle.findOwnedBySurface(
              entry.ownerId,
              entry.surface
            )
            if (existing !== undefined) return { inserted: false, existing }
            handle.insert(toRow(entry))
            return { inserted: true, existing: undefined }
          }),
        catch: () => failure("Create"),
      })
      if (inserted) {
        return deepFreeze({ _tag: "Created" as const, entry })
      }
      const canonical = yield* decodeRow(existing!, "Create")
      return sameCreation(canonical, entry)
        ? deepFreeze({ _tag: "Existing" as const, entry: canonical })
        : deepFreeze({
            _tag: "Conflict" as const,
            conflictingEntry: canonical,
          })
    })

  const update: ReadingDictionaryRepository["update"] = (
    ownerId,
    entryId,
    patch
  ) =>
    Effect.gen(function* () {
      const result = yield* Effect.try({
        try: () =>
          handle.transaction(() => {
            const current = handle.findOwnedById(ownerId, entryId)
            if (current === undefined) return { _tag: "NotFound" as const }
            const surface = patch.surface ?? current.surface
            const conflict = handle.findOwnedBySurface(ownerId, surface)
            if (conflict !== undefined && conflict.id !== entryId) {
              return { _tag: "Conflict" as const, row: conflict }
            }
            handle.update({
              ownerId,
              entryId,
              surface,
              reading: patch.reading ?? current.reading,
              accentType: patch.accentType ?? current.accentType,
              updatedAt: encodeTimestamp(patch.updatedAt),
            })
            return {
              _tag: "Updated" as const,
              row: handle.findOwnedById(ownerId, entryId)!,
            }
          }),
        catch: () => failure("Update"),
      })
      if (result._tag === "NotFound") return deepFreeze(result)
      const entry = yield* decodeRow(result.row, "Update")
      return result._tag === "Updated"
        ? deepFreeze({ _tag: "Updated" as const, entry })
        : deepFreeze({
            _tag: "Conflict" as const,
            conflictingEntry: entry,
          })
    })

  const remove: ReadingDictionaryRepository["remove"] = (ownerId, entryId) =>
    Effect.try({
      try: () => handle.remove(ownerId, entryId),
      catch: () => failure("Delete"),
    }).pipe(
      Effect.map((deleted) =>
        deepFreeze({ _tag: deleted ? ("Deleted" as const) : ("NotFound" as const) })
      )
    )

  const captureSnapshot: ReadingDictionaryRepository["captureSnapshot"] = (
    ownerId
  ) =>
    list(ownerId).pipe(
      Effect.flatMap((entries) => {
        const snapshotEntries = deepFreeze(
          entries.map(({ surface, reading, accentType }) =>
            deepFreeze({ surface, reading, accentType })
          )
        )
        const canonical = JSON.stringify({ ownerId, entries: snapshotEntries })
        const fingerprint = dictionaryFingerprintUnsafe(canonical)
        return parse(ReadingDictionarySnapshotSchema)({
          ownerId,
          fingerprint,
          entries: snapshotEntries,
        }).pipe(
          Effect.map(deepFreeze),
          Effect.mapError(() => failure("Snapshot", "CorruptRecord"))
        )
      })
    )

  return deepFreeze({ create, list, update, remove, captureSnapshot })
}

export type SqliteReadingDictionaryRepository = ReturnType<
  typeof repositoryFromHandle
>

export const sqliteReadingDictionaryRepository = (
  databasePath: string
): Effect.Effect<
  SqliteReadingDictionaryRepository,
  ReadingDictionaryStoreError,
  Scope.Scope
> =>
  Effect.acquireRelease(
    Effect.try({
      try: () => openUnsafeReadingDictionaryHandle(databasePath),
      catch: () => failure("Open"),
    }),
    (handle) => Effect.sync(() => handle.close())
  ).pipe(Effect.map(repositoryFromHandle))
