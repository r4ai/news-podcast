import { describe, expect, it } from "vitest"

import { IN_MEMORY_DATABASE_PATH, openDatabaseClientUnsafe } from "./client.js"
import { createTemporaryDatabase } from "./testing/index.js"

const readPragma = (
  client: ReturnType<typeof openDatabaseClientUnsafe>,
  pragma: string
): unknown => {
  const row = client.prepare(`PRAGMA ${pragma}`).get()
  return row === undefined ? undefined : Object.values(row)[0]
}

describe("openDatabaseClientUnsafe", () => {
  it("enforces foreign keys so cascade rules are not silently ignored", () => {
    const client = openDatabaseClientUnsafe({
      path: IN_MEMORY_DATABASE_PATH,
    })

    expect(readPragma(client, "foreign_keys")).toBe(1)
    client.close()
  })

  it("does not enable WAL for in-memory databases", () => {
    const client = openDatabaseClientUnsafe({
      path: IN_MEMORY_DATABASE_PATH,
    })

    expect(readPragma(client, "journal_mode")).toBe("memory")
    client.close()
  })

  it("enables WAL for file-backed databases", () => {
    const database = createTemporaryDatabase(() => {})

    expect(readPragma(database.client, "journal_mode")).toBe("wal")
    database.close()
  })

  it("applies a busy timeout so concurrent writers wait instead of failing", () => {
    const client = openDatabaseClientUnsafe({
      path: IN_MEMORY_DATABASE_PATH,
    })

    expect(readPragma(client, "busy_timeout")).toBe(5000)
    client.close()
  })
})

describe("createTemporaryDatabase", () => {
  it("applies the supplied migration before handing the client over", () => {
    const database = createTemporaryDatabase((client) => {
      client.exec("CREATE TABLE example (id TEXT PRIMARY KEY) STRICT")
    })

    const row = database.client
      .prepare("SELECT name FROM sqlite_master WHERE name = ?")
      .get("example")

    expect(row).toEqual({ name: "example" })
    database.close()
  })

  it("cleans up the temporary directory when the migration throws", () => {
    expect(() =>
      createTemporaryDatabase(() => {
        throw new Error("migration failed")
      })
    ).toThrow("migration failed")
  })
})
