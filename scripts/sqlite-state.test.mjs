import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { backupDatabase, restoreDatabase } from "./sqlite-state.mjs"

test("online backup and offline restore preserve a healthy SQLite database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sqlite-state-"))
  try {
    const source = join(directory, "source.sqlite")
    const archived = join(directory, "backup", "source.sqlite")
    const restored = join(directory, "restored.sqlite")
    const database = new DatabaseSync(source)
    database.exec("PRAGMA journal_mode=WAL; CREATE TABLE values_for_test(value TEXT NOT NULL)")
    database.prepare("INSERT INTO values_for_test(value) VALUES (?)").run("durable")
    await backupDatabase(source, archived)
    database.close()

    await restoreDatabase(archived, restored)
    const copy = new DatabaseSync(restored, { readOnly: true })
    assert.equal(
      copy.prepare("SELECT value FROM values_for_test").get()?.value,
      "durable"
    )
    copy.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("restore refuses to overwrite an existing service database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sqlite-state-"))
  try {
    const source = join(directory, "backup.sqlite")
    const destination = join(directory, "live.sqlite")
    new DatabaseSync(source).close()
    new DatabaseSync(destination).close()
    await assert.rejects(
      restoreDatabase(source, destination),
      /restore target already exists/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
