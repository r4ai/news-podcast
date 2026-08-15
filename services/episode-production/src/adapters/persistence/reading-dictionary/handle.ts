import { and, asc, eq } from "drizzle-orm"

import { readingDictionary } from "../../../../drizzle/schema.js"
import type { ProductionDatabase } from "../../../infrastructure/unsafe/drizzle/open.js"

export type ReadingDictionaryRow = Readonly<{
  id: string
  ownerId: string
  surface: string
  reading: string
  accentType: number
  source: string
  episodeJobId: string | null
  createdAt: string
  updatedAt: string
}>

export type UnsafeReadingDictionaryHandle = Readonly<{
  transaction: <Value>(body: () => Value) => Value
  findOwnedById: (
    ownerId: string,
    entryId: string
  ) => ReadingDictionaryRow | undefined
  findOwnedBySurface: (
    ownerId: string,
    surface: string
  ) => ReadingDictionaryRow | undefined
  listOwned: (ownerId: string) => readonly ReadingDictionaryRow[]
  insert: (row: ReadingDictionaryRow) => void
  update: (input: {
    readonly ownerId: string
    readonly entryId: string
    readonly surface: string
    readonly reading: string
    readonly accentType: number
    readonly updatedAt: string
  }) => void
  remove: (ownerId: string, entryId: string) => boolean
  close: () => void
}>

const projection = {
  id: readingDictionary.id,
  ownerId: readingDictionary.ownerId,
  surface: readingDictionary.surface,
  reading: readingDictionary.reading,
  accentType: readingDictionary.accentType,
  source: readingDictionary.source,
  episodeJobId: readingDictionary.episodeJobId,
  createdAt: readingDictionary.createdAt,
  updatedAt: readingDictionary.updatedAt,
}

export const makeReadingDictionaryHandle = (
  database: ProductionDatabase
): UnsafeReadingDictionaryHandle => ({
  // ドライバは同期なので、非同期コールバックを禁じる条件型だけを解消する。
  transaction: <Value>(body: () => Value): Value =>
    (database.transaction as (run: () => Value) => Value)(body),

  findOwnedById: (ownerId, entryId) =>
    database
      .select(projection)
      .from(readingDictionary)
      .where(
        and(
          eq(readingDictionary.ownerId, ownerId),
          eq(readingDictionary.id, entryId)
        )
      )
      .get(),

  findOwnedBySurface: (ownerId, surface) =>
    database
      .select(projection)
      .from(readingDictionary)
      .where(
        and(
          eq(readingDictionary.ownerId, ownerId),
          eq(readingDictionary.surface, surface)
        )
      )
      .get(),

  listOwned: (ownerId) =>
    database
      .select(projection)
      .from(readingDictionary)
      .where(eq(readingDictionary.ownerId, ownerId))
      .orderBy(asc(readingDictionary.surface), asc(readingDictionary.id))
      .all(),

  insert: (row) => {
    database
      .insert(readingDictionary)
      .values({
        id: row.id,
        ownerId: row.ownerId,
        surface: row.surface,
        reading: row.reading,
        accentType: row.accentType,
        source: row.source as "manual" | "ai_auto",
        episodeJobId: row.episodeJobId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
      .run()
  },

  update: (input) => {
    database
      .update(readingDictionary)
      .set({
        surface: input.surface,
        reading: input.reading,
        accentType: input.accentType,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(readingDictionary.ownerId, input.ownerId),
          eq(readingDictionary.id, input.entryId)
        )
      )
      .run()
  },

  remove: (ownerId, entryId) =>
    Number(
      database
        .delete(readingDictionary)
        .where(
          and(
            eq(readingDictionary.ownerId, ownerId),
            eq(readingDictionary.id, entryId)
          )
        )
        .run().changes
    ) === 1,

  close: () => {
    // 接続はサービスプロセスが所有する。
  },
})
