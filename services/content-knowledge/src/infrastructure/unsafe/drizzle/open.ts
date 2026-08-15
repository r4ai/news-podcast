import { dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

import { openDatabaseClientUnsafe } from "@news-podcast/persistence"
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"
import { migrate } from "drizzle-orm/node-sqlite/migrator"

export type ContentKnowledgeDatabase = NodeSQLiteDatabase

/**
 * 接続とトランザクションの両方で使えるクエリ発行面。
 * 同じ読み書きをトランザクション内外で共有するために必要。
 */
export type QueryRunner = Pick<
  ContentKnowledgeDatabase,
  "select" | "selectDistinct" | "insert" | "update" | "delete"
>

export type ContentKnowledgeDatabaseHandle = Readonly<{
  readonly database: ContentKnowledgeDatabase
  readonly client: DatabaseSync
  readonly close: () => void
}>

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../drizzle/migrations"
)

/**
 * 接続確立とマイグレーション適用をまとめた唯一の入口。
 * サービスプロセスにつき1本だけ開く。
 */
export const openContentKnowledgeDatabaseUnsafe = (
  databasePath: string
): ContentKnowledgeDatabaseHandle => {
  const client = openDatabaseClientUnsafe({ path: databasePath })
  const database = drizzle({ client })

  migrate(database, { migrationsFolder })

  return { database, client, close: () => client.close() }
}
