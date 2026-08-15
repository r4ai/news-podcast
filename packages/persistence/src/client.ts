import { DatabaseSync } from "node:sqlite"

import type { DeepReadonly } from "@news-podcast/kernel"

export type DatabaseClientOptions = DeepReadonly<{
  readonly path: string
  /** バックアップ検証など、書き込みを伴わない用途にのみ使う。 */
  readonly readOnly?: boolean
}>

export const IN_MEMORY_DATABASE_PATH = ":memory:"

/**
 * 接続確立の規則を集約する唯一の場所。
 * 以前はサービスごとに5箇所へ複製され、`:memory:`でのWAL有無など規則が食い違っていた。
 */
export const openDatabaseClientUnsafe = (
  options: DatabaseClientOptions
): DatabaseSync => {
  const client = new DatabaseSync(
    options.path,
    options.readOnly === true ? { readOnly: true } : {}
  )

  client.exec("PRAGMA foreign_keys = ON")
  client.exec("PRAGMA busy_timeout = 5000")

  // WALはファイル実体を前提とするため、インメモリDBでは指定しない。
  if (options.path !== IN_MEMORY_DATABASE_PATH && options.readOnly !== true) {
    client.exec("PRAGMA journal_mode = WAL")
  }

  return client
}
