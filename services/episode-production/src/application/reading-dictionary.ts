import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  OwnerIdSchema,
  UtcTimestampSchema,
  type JobId,
  type OwnerId,
  type UtcTimestamp,
} from "../domain/episode-job.js"
import {
  ReadingAccentTypeSchema,
  ReadingDictionaryEntrySchema,
  ReadingDictionaryIdSchema,
  ReadingPronunciationSchema,
  ReadingSurfaceSchema,
  type ReadingDictionaryEntry,
  type ReadingDictionaryId,
  type ReadingDictionarySnapshot,
  type ReadingPronunciation,
  type ReadingSurface,
} from "../domain/reading-dictionary.js"
import type {
  ReadingTermCandidate,
  ReadingTermExtractor,
} from "./ports/reading-term-extractor.js"

export type ReadingDictionaryStoreError = DeepReadonly<{
  readonly _tag: "ReadingDictionaryStoreFailed"
  readonly operation:
    | "Open"
    | "Create"
    | "List"
    | "Update"
    | "Delete"
    | "Snapshot"
  readonly reason: "Unavailable" | "CorruptRecord"
}>

export type CreateReadingDictionaryResult = DeepReadonly<
  | { readonly _tag: "Created"; readonly entry: ReadingDictionaryEntry }
  | { readonly _tag: "Existing"; readonly entry: ReadingDictionaryEntry }
  | {
      readonly _tag: "Conflict"
      readonly conflictingEntry: ReadingDictionaryEntry
    }
>

export type UpdateReadingDictionaryResult = DeepReadonly<
  | { readonly _tag: "Updated"; readonly entry: ReadingDictionaryEntry }
  | { readonly _tag: "NotFound" }
  | {
      readonly _tag: "Conflict"
      readonly conflictingEntry: ReadingDictionaryEntry
    }
>

export type DeleteReadingDictionaryResult = DeepReadonly<
  { readonly _tag: "Deleted" } | { readonly _tag: "NotFound" }
>

export type ReadingDictionaryPatch = DeepReadonly<{
  readonly surface?: ReadingSurface
  readonly reading?: ReadingPronunciation
  readonly accentType?: Schema.Schema.Type<typeof ReadingAccentTypeSchema>
  readonly updatedAt: UtcTimestamp
}>

export type ReadingDictionaryRepository = DeepReadonly<{
  readonly create: (
    entry: ReadingDictionaryEntry
  ) => Effect.Effect<CreateReadingDictionaryResult, ReadingDictionaryStoreError>
  readonly list: (
    ownerId: OwnerId
  ) => Effect.Effect<
    readonly ReadingDictionaryEntry[],
    ReadingDictionaryStoreError
  >
  readonly update: (
    ownerId: OwnerId,
    entryId: ReadingDictionaryId,
    patch: ReadingDictionaryPatch
  ) => Effect.Effect<UpdateReadingDictionaryResult, ReadingDictionaryStoreError>
  readonly remove: (
    ownerId: OwnerId,
    entryId: ReadingDictionaryId
  ) => Effect.Effect<DeleteReadingDictionaryResult, ReadingDictionaryStoreError>
  readonly captureSnapshot: (
    ownerId: OwnerId
  ) => Effect.Effect<ReadingDictionarySnapshot, ReadingDictionaryStoreError>
}>

const CreateManualEntrySchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  surface: ReadingSurfaceSchema,
  reading: ReadingPronunciationSchema,
  accentType: Schema.optional(ReadingAccentTypeSchema),
})
const parseCreateManualEntry = parse(CreateManualEntrySchema)
const encodeTimestamp = Schema.encodeSync(UtcTimestampSchema)
const defaultAccentType = Schema.decodeUnknownSync(ReadingAccentTypeSchema)(0)

const atLeastOnePatchField = Schema.makeFilter<{
  readonly surface?: ReadingSurface
  readonly reading?: ReadingPronunciation
  readonly accentType?: Schema.Schema.Type<typeof ReadingAccentTypeSchema>
}>((patch) =>
  patch.surface !== undefined ||
  patch.reading !== undefined ||
  patch.accentType !== undefined
    ? true
    : "at least one dictionary field must be updated"
)

const UpdateEntrySchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  id: ReadingDictionaryIdSchema,
  patch: Schema.Struct({
    surface: Schema.optional(ReadingSurfaceSchema),
    reading: Schema.optional(ReadingPronunciationSchema),
    accentType: Schema.optional(ReadingAccentTypeSchema),
  }).check(atLeastOnePatchField),
})
const parseUpdateEntry = parse(UpdateEntrySchema)

export const createReadingDictionaryEntry = (
  ports: Pick<ReadingDictionaryRepository, "create"> & {
    readonly nextId: Effect.Effect<ReadingDictionaryId>
    readonly now: Effect.Effect<UtcTimestamp>
  },
  input: unknown
) =>
  parseCreateManualEntry(input).pipe(
    Effect.flatMap((command) =>
      Effect.all([ports.nextId, ports.now]).pipe(
        Effect.flatMap(([id, now]) =>
          parse(ReadingDictionaryEntrySchema)({
            id,
            ownerId: command.ownerId,
            surface: command.surface,
            reading: command.reading,
            accentType: command.accentType ?? defaultAccentType,
            source: "manual",
            episodeJobId: null,
            createdAt: encodeTimestamp(now),
            updatedAt: encodeTimestamp(now),
          })
        ),
        Effect.map(deepFreeze),
        Effect.flatMap((entry) => ports.create(entry))
      )
    )
  )

export const listReadingDictionaryEntries = (
  repository: Pick<ReadingDictionaryRepository, "list">,
  ownerId: OwnerId
) => repository.list(ownerId)

export const updateReadingDictionaryEntry = (
  ports: Pick<ReadingDictionaryRepository, "update"> & {
    readonly now: Effect.Effect<UtcTimestamp>
  },
  input: unknown
) =>
  parseUpdateEntry(input).pipe(
    Effect.flatMap((command) =>
      ports.now.pipe(
        Effect.flatMap((updatedAt) =>
          ports.update(
            command.ownerId,
            command.id,
            deepFreeze({ ...command.patch, updatedAt })
          )
        )
      )
    )
  )

export const deleteReadingDictionaryEntry = (
  repository: Pick<ReadingDictionaryRepository, "remove">,
  ownerId: OwnerId,
  entryId: ReadingDictionaryId
) => repository.remove(ownerId, entryId)

export const captureReadingDictionarySnapshot = (
  repository: Pick<ReadingDictionaryRepository, "captureSnapshot">,
  ownerId: OwnerId
) => repository.captureSnapshot(ownerId)

const normalizedSurfaceKey = (surface: string) =>
  surface.normalize("NFKC").trim().toLocaleLowerCase("ja")

export type PreparedReadingDictionary = DeepReadonly<{
  readonly snapshot: ReadingDictionarySnapshot
  readonly addedCount: number
  readonly extractionFailed: boolean
}>

/**
 * Best-effort AI extraction followed by durable owner-scoped registration.
 * Provider failure never blocks audio; persistence failure remains retryable by the caller.
 */
export const prepareReadingDictionary = (
  ports: Pick<
    ReadingDictionaryRepository,
    "list" | "create" | "captureSnapshot"
  > & {
    readonly extractor: ReadingTermExtractor
    readonly nextId: () => ReadingDictionaryId
    readonly now: () => UtcTimestamp
  },
  input: {
    readonly ownerId: OwnerId
    readonly episodeJobId: JobId
    readonly script: string
    readonly signal?: AbortSignal
  }
): Effect.Effect<PreparedReadingDictionary, ReadingDictionaryStoreError> =>
  ports.extractor
    .extract({
      script: input.script,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    .pipe(
      Effect.matchEffect({
        onFailure: () =>
          Effect.succeed({
            candidates: [] as readonly ReadingTermCandidate[],
            extractionFailed: true,
          }),
        onSuccess: (candidates) =>
          Effect.succeed({ candidates, extractionFailed: false }),
      }),
      Effect.flatMap(({ candidates, extractionFailed }) =>
        ports.list(input.ownerId).pipe(
          Effect.flatMap((existing) => {
            const seen = new Set(
              existing.map(({ surface }) => normalizedSurfaceKey(surface))
            )
            const normalizedScript = input.script
              .normalize("NFKC")
              .toLocaleLowerCase("ja")
            const unique = candidates.filter(({ surface }) => {
              const key = normalizedSurfaceKey(surface)
              if (!normalizedScript.includes(key) || seen.has(key)) return false
              seen.add(key)
              return true
            })
            return Effect.forEach(
              unique,
              (candidate) => {
                const now = ports.now()
                const entry = Schema.decodeUnknownSync(
                  ReadingDictionaryEntrySchema
                )({
                  id: ports.nextId(),
                  ownerId: input.ownerId,
                  ...candidate,
                  source: "ai_auto",
                  episodeJobId: input.episodeJobId,
                  createdAt: encodeTimestamp(now),
                  updatedAt: encodeTimestamp(now),
                })
                return ports.create(deepFreeze(entry))
              },
              { concurrency: 1 }
            ).pipe(
              Effect.flatMap((results) =>
                ports.captureSnapshot(input.ownerId).pipe(
                  Effect.map((snapshot) =>
                    deepFreeze({
                      snapshot,
                      addedCount: results.filter(
                        ({ _tag }) => _tag === "Created"
                      ).length,
                      extractionFailed,
                    })
                  )
                )
              )
            )
          })
        )
      )
    )
