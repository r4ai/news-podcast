import { type DeepReadonly } from "@news-podcast/kernel"
import { Schema } from "effect"

import {
  JobIdSchema,
  OwnerIdSchema,
  UtcTimestampSchema,
} from "./episode-job.js"

const uuid = <Brand extends string>(brand: Brand) =>
  Schema.String.check(Schema.isUUID(4)).pipe(Schema.brand(brand))

export const ReadingDictionaryIdSchema = uuid("ReadingDictionaryId")
export type ReadingDictionaryId = Schema.Schema.Type<
  typeof ReadingDictionaryIdSchema
>

export const ReadingSurfaceSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
  Schema.makeFilter((surface) =>
    [...surface].every((character) => {
      const codePoint = character.codePointAt(0)!
      return codePoint > 31 && codePoint !== 127
    })
      ? true
      : "surface must not contain control characters"
  )
).pipe(Schema.brand("ReadingSurface"))
export type ReadingSurface = Schema.Schema.Type<typeof ReadingSurfaceSchema>

export const ReadingPronunciationSchema = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
  Schema.isPattern(/^[ァ-ヶー・ ]+$/u)
).pipe(Schema.brand("ReadingPronunciation"))
export type ReadingPronunciation = Schema.Schema.Type<
  typeof ReadingPronunciationSchema
>

export const ReadingAccentTypeSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(100)
).pipe(Schema.brand("ReadingAccentType"))
export type ReadingAccentType = Schema.Schema.Type<
  typeof ReadingAccentTypeSchema
>

export const ReadingSourceSchema = Schema.Literals(["manual", "ai_auto"])
export type ReadingSource = Schema.Schema.Type<typeof ReadingSourceSchema>

export const ReadingDictionaryEntrySchema = Schema.Struct({
  id: ReadingDictionaryIdSchema,
  ownerId: OwnerIdSchema,
  surface: ReadingSurfaceSchema,
  reading: ReadingPronunciationSchema,
  accentType: ReadingAccentTypeSchema,
  source: ReadingSourceSchema,
  episodeJobId: Schema.NullOr(JobIdSchema),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
})
export type ReadingDictionaryEntry = DeepReadonly<
  Schema.Schema.Type<typeof ReadingDictionaryEntrySchema>
>

export const ReadingDictionarySnapshotEntrySchema = Schema.Struct({
  surface: ReadingSurfaceSchema,
  reading: ReadingPronunciationSchema,
  accentType: ReadingAccentTypeSchema,
})
export type ReadingDictionarySnapshotEntry = DeepReadonly<
  Schema.Schema.Type<typeof ReadingDictionarySnapshotEntrySchema>
>

export const ReadingDictionaryFingerprintSchema = Schema.String.check(
  Schema.isPattern(/^[a-f\d]{64}$/)
).pipe(Schema.brand("ReadingDictionaryFingerprint"))
export type ReadingDictionaryFingerprint = Schema.Schema.Type<
  typeof ReadingDictionaryFingerprintSchema
>

/**
 * A generation attempt consumes this value, never a live dictionary view.
 * The fingerprint covers ownerId and the canonically sorted pronunciation rows.
 */
export const ReadingDictionarySnapshotSchema = Schema.Struct({
  ownerId: OwnerIdSchema,
  fingerprint: ReadingDictionaryFingerprintSchema,
  entries: Schema.Array(ReadingDictionarySnapshotEntrySchema),
})
export type ReadingDictionarySnapshot = DeepReadonly<
  Schema.Schema.Type<typeof ReadingDictionarySnapshotSchema>
>
