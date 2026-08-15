import { dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

import { openDatabaseClientUnsafe } from "@news-podcast/persistence"
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"
import { migrate } from "drizzle-orm/node-sqlite/migrator"

export type EpisodeLibraryDatabase = NodeSQLiteDatabase

export type EpisodeLibraryDatabaseHandle = Readonly<{
  readonly database: EpisodeLibraryDatabase
  /** バックアップや整合性検査など、ORMに存在しない操作のための逃げ道。 */
  readonly client: DatabaseSync
  readonly close: () => void
}>

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../drizzle/migrations"
)

/**
 * 接続確立とマイグレーション適用をまとめた唯一の入口。
 * 起動時DDL（CREATE TABLE IF NOT EXISTS）はここに置き換わった。
 */
export const openEpisodeLibraryDatabaseUnsafe = (
  databasePath: string
): EpisodeLibraryDatabaseHandle => {
  const client = openDatabaseClientUnsafe({ path: databasePath })
  const database = drizzle({ client })

  migrate(database, { migrationsFolder })

  return {
    database,
    client,
    close: () => client.close(),
  }
}
