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
    database.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE episode_jobs(value TEXT NOT NULL)"
    )
    database.prepare("INSERT INTO episode_jobs(value) VALUES (?)").run("durable")
    await backupDatabase("production", source, archived)
    database.close()

    await restoreDatabase("production", archived, restored)
    const copy = new DatabaseSync(restored, { readOnly: true })
    assert.equal(
      copy.prepare("SELECT value FROM episode_jobs").get()?.value,
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
    const backup = new DatabaseSync(source)
    backup.exec("CREATE TABLE episodes(id TEXT PRIMARY KEY)")
    backup.close()
    const live = new DatabaseSync(destination)
    live.exec("CREATE TABLE episodes(id TEXT PRIMARY KEY)")
    live.close()
    await assert.rejects(
      restoreDatabase("library", source, destination),
      /restore target already exists/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("restore rejects a healthy database from another service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sqlite-state-"))
  try {
    const source = join(directory, "content.sqlite")
    const destination = join(directory, "production.sqlite")
    const database = new DatabaseSync(source)
    database.exec("CREATE TABLE feed_subscriptions(id TEXT PRIMARY KEY)")
    database.close()

    await assert.rejects(
      restoreDatabase("production", source, destination),
      /database is not a production service backup/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
