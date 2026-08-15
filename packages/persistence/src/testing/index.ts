import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DatabaseSync } from "node:sqlite"

import type { DeepReadonly } from "@news-podcast/kernel"

import { openDatabaseClientUnsafe } from "../client.js"

export type TemporaryDatabase = DeepReadonly<{
  readonly client: DatabaseSync
  readonly path: string
  readonly close: () => void
}>

/**
 * テスト用DBは本番と同じマイグレーションで構築する。
 * 以前は各テストが`:memory:`へDDLを直書きしており、本番スキーマとの乖離を検知できなかった。
 */
export const createTemporaryDatabase = (
  migrate: (client: DatabaseSync) => void
): TemporaryDatabase => {
  const directory = mkdtempSync(join(tmpdir(), "news-podcast-db-"))
  const path = join(directory, "test.sqlite")
  const client = openDatabaseClientUnsafe({ path })

  try {
    migrate(client)
  } catch (cause) {
    client.close()
    rmSync(directory, { recursive: true, force: true })
    throw cause
  }

  const close = (): void => {
    try {
      client.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }

  return { client, path, close }
}
