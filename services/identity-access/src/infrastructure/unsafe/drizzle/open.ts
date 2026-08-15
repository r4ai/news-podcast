import { dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

import { openDatabaseClientUnsafe } from "@news-podcast/persistence"
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"
import { migrate } from "drizzle-orm/node-sqlite/migrator"

export type IdentityDatabase = NodeSQLiteDatabase

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../drizzle/migrations"
)

/**
 * Better Auth と同じ接続の上にIdentity所有のテーブルを載せる。
 * 両者のマイグレーションは対象テーブルが交わらないため順序に依存しない。
 */
export const attachIdentityDatabaseUnsafe = (
  client: DatabaseSync
): IdentityDatabase => {
  const database = drizzle({ client })
  migrate(database, { migrationsFolder })
  return database
}

/** Better Auth を伴わない、設定テーブル単独の利用者向け。 */
export const openIdentityDatabaseUnsafe = (
  databasePath: string
): Readonly<{
  readonly database: IdentityDatabase
  readonly client: DatabaseSync
  readonly close: () => void
}> => {
  const client = openDatabaseClientUnsafe({ path: databasePath })
  return {
    database: attachIdentityDatabaseUnsafe(client),
    client,
    close: () => client.close(),
  }
}
