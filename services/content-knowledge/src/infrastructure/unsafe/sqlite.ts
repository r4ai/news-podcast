import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import { deepFreeze } from "@news-podcast/kernel"

import type { SqlitePort } from "../../adapters/sqlite-port.js"

/** Throwing Node SQLite API is isolated here and converted to Effect by callers. */
export const openSqliteUnsafe = (path: string): SqlitePort => {
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
  const run = (sql: string, parameters: readonly SQLInputValue[] = []) => {
    const result = database.prepare(sql).run(...parameters)
    return deepFreeze({ changes: result.changes })
  }
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
        // The original SQLite failure is the actionable cause.
      }
      throw error
    }
  }
  const close = (): void => database.close()

  return deepFreeze({ execute, get, all, run, transaction, close })
}
