import { dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"

import { openDatabaseClientUnsafe } from "@news-podcast/persistence"
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"
import { migrate } from "drizzle-orm/node-sqlite/migrator"

export type ProductionDatabase = NodeSQLiteDatabase

/** 接続とトランザクションの両方で使えるクエリ発行面。 */
export type QueryRunner = Pick<
  ProductionDatabase,
  "select" | "selectDistinct" | "insert" | "update" | "delete"
>

export type ProductionDatabaseHandle = Readonly<{
  readonly database: ProductionDatabase
  readonly client: DatabaseSync
  readonly close: () => void
}>

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../drizzle/migrations"
)

/**
 * 接続確立とマイグレーション適用をまとめた唯一の入口。
 *
 * 以前は1プロセスで同じDBファイルへ6本の接続を開いており、
 * production_agent_runs → episode_jobs の外部キーが接続をまたいでいた。
 * サービスプロセスにつき1本へ集約する。
 */
export const openProductionDatabaseUnsafe = (
  databasePath: string
): ProductionDatabaseHandle => {
  const client = openDatabaseClientUnsafe({ path: databasePath })
  const database = drizzle({ client })

  migrate(database, { migrationsFolder })

  return { database, client, close: () => client.close() }
}
