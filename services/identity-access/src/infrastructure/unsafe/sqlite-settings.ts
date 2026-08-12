import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { deepFreeze } from "@news-podcast/kernel"
import type { IdentitySqlitePort } from "../../adapters/sqlite-port.js"

/** Throwing SQLite and mutable connection state stay behind this unsafe boundary. */
export const openIdentitySqliteUnsafe = (path: string): IdentitySqlitePort => {
  const database = new DatabaseSync(path)
  database.exec("PRAGMA foreign_keys = ON")
  database.exec("PRAGMA busy_timeout = 5000")
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL")
  const execute = (sql: string): void => database.exec(sql)
  const get = (
    sql: string,
    parameters: readonly SQLInputValue[] = []
  ): unknown => database.prepare(sql).get(...parameters)
  const all = (
    sql: string,
    parameters: readonly SQLInputValue[] = []
  ): readonly unknown[] => database.prepare(sql).all(...parameters)
  const run = (sql: string, parameters: readonly SQLInputValue[] = []) =>
    deepFreeze({ changes: database.prepare(sql).run(...parameters).changes })
  const transaction = <Value>(operation: () => Value): Value => {
    database.exec("BEGIN IMMEDIATE")
    try {
      const value = operation()
      database.exec("COMMIT")
      return value
    } catch (error) {
      try {
        database.exec("ROLLBACK")
      } catch {
        /* Preserve the original failure. */
      }
      throw error
    }
  }
  const close = (): void => database.close()
  return deepFreeze({ execute, get, all, run, transaction, close })
}
