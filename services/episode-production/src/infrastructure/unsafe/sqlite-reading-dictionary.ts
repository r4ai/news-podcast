import { DatabaseSync } from "node:sqlite"

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

const select = `
SELECT id,
       owner_id AS ownerId,
       surface,
       reading,
       accent_type AS accentType,
       source,
       episode_job_id AS episodeJobId,
       created_at AS createdAt,
       updated_at AS updatedAt
  FROM reading_dictionary`

/** The mutable Node SQLite API stays behind this narrow synchronous handle. */
export const openUnsafeReadingDictionaryHandle = (
  databasePath: string
): UnsafeReadingDictionaryHandle => {
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS reading_dictionary (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      surface TEXT NOT NULL,
      reading TEXT NOT NULL,
      accent_type INTEGER NOT NULL CHECK(accent_type BETWEEN 0 AND 100),
      source TEXT NOT NULL CHECK(source IN ('manual', 'ai_auto')),
      episode_job_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_id, surface)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS reading_dictionary_owner_surface
      ON reading_dictionary(owner_id, surface, id);
  `)

  const findOwnedById = database.prepare(
    `${select} WHERE owner_id = ? AND id = ?`
  )
  const findOwnedBySurface = database.prepare(
    `${select} WHERE owner_id = ? AND surface = ?`
  )
  const listOwned = database.prepare(
    `${select} WHERE owner_id = ? ORDER BY surface, id`
  )
  const insert = database.prepare(`
    INSERT INTO reading_dictionary(
      id, owner_id, surface, reading, accent_type, source,
      episode_job_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const update = database.prepare(`
    UPDATE reading_dictionary
       SET surface = ?, reading = ?, accent_type = ?, updated_at = ?
     WHERE owner_id = ? AND id = ?
  `)
  const remove = database.prepare(
    "DELETE FROM reading_dictionary WHERE owner_id = ? AND id = ?"
  )

  const transaction = <Value>(body: () => Value): Value => {
    database.exec("BEGIN IMMEDIATE")
    try {
      const value = body()
      database.exec("COMMIT")
      return value
    } catch (cause) {
      database.exec("ROLLBACK")
      throw cause
    }
  }

  return {
    transaction,
    findOwnedById: (ownerId, entryId) =>
      findOwnedById.get(ownerId, entryId) as ReadingDictionaryRow | undefined,
    findOwnedBySurface: (ownerId, surface) =>
      findOwnedBySurface.get(ownerId, surface) as
        | ReadingDictionaryRow
        | undefined,
    listOwned: (ownerId) =>
      listOwned.all(ownerId) as unknown as readonly ReadingDictionaryRow[],
    insert: (row) => {
      insert.run(
        row.id,
        row.ownerId,
        row.surface,
        row.reading,
        row.accentType,
        row.source,
        row.episodeJobId,
        row.createdAt,
        row.updatedAt
      )
    },
    update: (input) => {
      update.run(
        input.surface,
        input.reading,
        input.accentType,
        input.updatedAt,
        input.ownerId,
        input.entryId
      )
    },
    remove: (ownerId, entryId) => remove.run(ownerId, entryId).changes === 1,
    close: () => database.close(),
  }
}
