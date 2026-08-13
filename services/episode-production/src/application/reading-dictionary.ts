import { deepFreeze, parse, type DeepReadonly } from "@news-podcast/kernel"
import { Effect, Schema } from "effect"

import {
  OwnerIdSchema,
  UtcTimestampSchema,
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
