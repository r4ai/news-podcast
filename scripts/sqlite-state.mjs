#!/usr/bin/env node
import { access, copyFile, mkdir, rename, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { backup, DatabaseSync } from "node:sqlite"

const fail = (message) => {
  throw new Error(message)
}

export const serviceProfiles = Object.freeze({
  identity: Object.freeze(["user_settings"]),
  content: Object.freeze(["feed_subscriptions"]),
  production: Object.freeze(["episode_jobs"]),
  library: Object.freeze(["episodes"]),
})

const expectedTables = (profile) => {
  const tables = serviceProfiles[profile]
  if (!tables) fail(`unknown service profile: ${profile}`)
  return tables
}

const exists = async (path) =>
  access(path).then(
    () => true,
    () => false
  )

export const assertHealthyDatabase = (path, profile) => {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const result = database.prepare("PRAGMA integrity_check").get()
    if (result?.integrity_check !== "ok") fail("SQLite integrity_check failed")
    const present = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name)
    )
    for (const table of expectedTables(profile)) {
      if (!present.has(table))
        fail(`database is not a ${profile} service backup`)
    }
  } finally {
    database.close()
  }
}

export const backupDatabase = async (profile, source, destination) => {
  const sourcePath = resolve(source)
  const destinationPath = resolve(destination)
  if (sourcePath === destinationPath) fail("source and destination must differ")
  if (!(await exists(sourcePath))) fail("source database does not exist")
  if (await exists(destinationPath)) fail("backup destination already exists")
  assertHealthyDatabase(sourcePath, profile)
  await mkdir(dirname(destinationPath), { recursive: true })
  const database = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    await backup(database, destinationPath)
  } finally {
    database.close()
  }
  assertHealthyDatabase(destinationPath, profile)
}

export const restoreDatabase = async (profile, source, destination) => {
  const sourcePath = resolve(source)
  const destinationPath = resolve(destination)
  if (sourcePath === destinationPath) fail("source and destination must differ")
  if (!(await exists(sourcePath))) fail("backup database does not exist")
  if (await exists(destinationPath)) fail("restore target already exists")
  assertHealthyDatabase(sourcePath, profile)
  await mkdir(dirname(destinationPath), { recursive: true })
  const temporary = `${destinationPath}.restoring`
  await rm(temporary, { force: true })
  try {
    await copyFile(sourcePath, temporary)
    assertHealthyDatabase(temporary, profile)
    await rename(temporary, destinationPath)
  } finally {
    await rm(temporary, { force: true })
  }
}

const main = async () => {
  const [operation, profile, source, destination] = process.argv.slice(2)
  if (
    !source ||
    !destination ||
    !["backup", "restore"].includes(operation) ||
    !Object.hasOwn(serviceProfiles, profile)
  )
    fail(
      "usage: sqlite-state.mjs <backup|restore> <identity|content|production|library> <source> <destination>"
    )
  if (operation === "backup") await backupDatabase(profile, source, destination)
  else await restoreDatabase(profile, source, destination)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  void main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "SQLite state failed"
    )
    process.exitCode = 1
  })
}
