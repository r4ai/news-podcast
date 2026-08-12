#!/usr/bin/env node
import { access, copyFile, mkdir, rename, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { backup, DatabaseSync } from "node:sqlite"

const fail = (message) => {
  throw new Error(message)
}

const exists = async (path) =>
  access(path).then(
    () => true,
    () => false
  )

export const assertHealthyDatabase = (path) => {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const result = database.prepare("PRAGMA integrity_check").get()
    if (result?.integrity_check !== "ok") fail("SQLite integrity_check failed")
  } finally {
    database.close()
  }
}

export const backupDatabase = async (source, destination) => {
  const sourcePath = resolve(source)
  const destinationPath = resolve(destination)
  if (sourcePath === destinationPath) fail("source and destination must differ")
  if (!(await exists(sourcePath))) fail("source database does not exist")
  if (await exists(destinationPath)) fail("backup destination already exists")
  await mkdir(dirname(destinationPath), { recursive: true })
  const database = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    await backup(database, destinationPath)
  } finally {
    database.close()
  }
  assertHealthyDatabase(destinationPath)
}

export const restoreDatabase = async (source, destination) => {
  const sourcePath = resolve(source)
  const destinationPath = resolve(destination)
  if (sourcePath === destinationPath) fail("source and destination must differ")
  if (!(await exists(sourcePath))) fail("backup database does not exist")
  if (await exists(destinationPath)) fail("restore target already exists")
  assertHealthyDatabase(sourcePath)
  await mkdir(dirname(destinationPath), { recursive: true })
  const temporary = `${destinationPath}.restoring`
  await rm(temporary, { force: true })
  try {
    await copyFile(sourcePath, temporary)
    assertHealthyDatabase(temporary)
    await rename(temporary, destinationPath)
  } finally {
    await rm(temporary, { force: true })
  }
}

const main = async () => {
  const [operation, source, destination] = process.argv.slice(2)
  if (!source || !destination || !["backup", "restore"].includes(operation))
    fail("usage: sqlite-state.mjs <backup|restore> <source> <destination>")
  if (operation === "backup") await backupDatabase(source, destination)
  else await restoreDatabase(source, destination)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "SQLite state failed")
    process.exitCode = 1
  })
}
