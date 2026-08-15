import { randomUUID } from "node:crypto"
import { copyFile, link, open, rm, unlink } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { backup, DatabaseSync } from "node:sqlite"

import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

export type EpisodeLibraryBackupFailure = Readonly<{
  _tag: "EpisodeLibraryBackupFailure"
  operation: "backup" | "restore" | "validate"
}>

const backupFailure = (
  operation: EpisodeLibraryBackupFailure["operation"]
): EpisodeLibraryBackupFailure =>
  deepFreeze({ _tag: "EpisodeLibraryBackupFailure", operation })

/**
 * オンラインバックアップと整合性検査はnode:sqlite固有の機能であり、
 * ORMに同等のAPIが無い。永続化層で唯一ドライバに直接触れる場所。
 */
export const backupDatabaseUnsafe = (
  database: DatabaseSync,
  destinationPath: string
): Effect.Effect<number, EpisodeLibraryBackupFailure> =>
  Effect.tryPromise({
    try: async () => {
      let reserved = false
      try {
        const handle = await open(destinationPath, "wx")
        await handle.close()
        reserved = true
        return await backup(database, destinationPath)
      } catch (error) {
        if (reserved) await rm(destinationPath, { force: true })
        throw error
      }
    },
    catch: () => backupFailure("backup"),
  })

const requiredTables = [
  "episode_completion_inbox",
  "episodes",
  "episode_sources",
]

const validateBackup = (backupPath: string): void => {
  const database = new DatabaseSync(backupPath, { readOnly: true })
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get()
    if (integrity?.integrity_check !== "ok") {
      throw new Error("SQLite integrity check failed")
    }
    const tables = new Set(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN (?, ?, ?)`
        )
        .all(...requiredTables)
        .map((row) => row.name)
    )
    if (requiredTables.some((table) => !tables.has(table))) {
      throw new Error("Not an episode-library SQLite backup")
    }
  } finally {
    database.close()
  }
}

/**
 * 検証済みバックアップを新しいパスへ復元する。既存DBは決して上書きせず、
 * 切り替えは運用者の明示的な操作として残す。
 */
export const restoreEpisodeLibraryBackup = (
  backupPath: string,
  databasePath: string
): Effect.Effect<void, EpisodeLibraryBackupFailure> =>
  Effect.tryPromise({
    try: async () => {
      try {
        validateBackup(backupPath)
      } catch {
        throw backupFailure("validate")
      }
      const temporaryPath = join(
        dirname(databasePath),
        `.${basename(databasePath)}.${randomUUID()}.restore`
      )
      try {
        await copyFile(backupPath, temporaryPath)
        validateBackup(temporaryPath)
        await link(temporaryPath, databasePath)
      } finally {
        await unlink(temporaryPath).catch(() => undefined)
      }
    },
    catch: (error) =>
      typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      error._tag === "EpisodeLibraryBackupFailure"
        ? (error as EpisodeLibraryBackupFailure)
        : backupFailure("restore"),
  })
