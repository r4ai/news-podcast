import type { SQLInputValue } from "node:sqlite"

import { openContentKnowledgeDatabaseUnsafe } from "../../infrastructure/unsafe/drizzle/open.js"

/**
 * テスト用のDB。本番と同じマイグレーションで組み立てる。
 *
 * 固定値の投入と結果の検証には素のSQLが要るため、ドライバへの
 * 逃げ道を `*Sql` として明示的に分けて公開する。Drizzle自身の
 * `run`/`get`/`all` と名前で衝突させない。
 */
export const openTestDatabase = () => {
  const handle = openContentKnowledgeDatabaseUnsafe(":memory:")

  return {
    db: handle.database,
    client: handle.client,
    execSql: (sql: string): void => handle.client.exec(sql),
    runSql: (sql: string, parameters: readonly SQLInputValue[] = []) =>
      handle.client.prepare(sql).run(...parameters),
    getSql: (sql: string, parameters: readonly SQLInputValue[] = []): unknown =>
      handle.client.prepare(sql).get(...parameters),
    allSql: (
      sql: string,
      parameters: readonly SQLInputValue[] = []
    ): readonly unknown[] => handle.client.prepare(sql).all(...parameters),
    close: (): void => handle.close(),
  }
}

export type TestDatabase = ReturnType<typeof openTestDatabase>
