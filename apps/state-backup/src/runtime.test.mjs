import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { BackupRuntime, renderMetrics } from "./runtime.mjs"

test("runtime records committed backups, drills, age, and failures durably", async () => {
  const directory = await mkdtemp(join(tmpdir(), "backup-runtime-"))
  const statePath = join(directory, "state.json")
  let now = new Date("2026-08-20T00:00:00.000Z")
  let backupCalls = 0
  let drillCalls = 0
  try {
    const runtime = await BackupRuntime.open({
      statePath,
      now: () => now,
      createGeneration: async () => {
        backupCalls += 1
        return { commit: { generationId: "generation-a" } }
      },
      runRestoreDrill: async () => {
        drillCalls += 1
        return { generationId: "generation-a" }
      },
    })

    assert.equal(await runtime.runBackup(), true)
    now = new Date("2026-08-20T01:00:00.000Z")
    assert.equal(await runtime.runRestoreDrill(), true)
    now = new Date("2026-08-20T02:00:00.000Z")
    assert.match(
      renderMetrics(runtime.snapshot(), now),
      /generation_age_seconds 7200/
    )
    assert.equal(backupCalls, 1)
    assert.equal(drillCalls, 1)

    const persisted = JSON.parse(await readFile(statePath, "utf8"))
    assert.equal(persisted.lastBackupGeneration, "generation-a")
    assert.equal(persisted.lastDrillGeneration, "generation-a")

    const failing = await BackupRuntime.open({
      statePath,
      now: () => now,
      createGeneration: async () => {
        throw new Error("remote unavailable")
      },
      runRestoreDrill: async () => {
        throw new Error("corrupt generation")
      },
      logger: { error() {} },
    })
    assert.equal(await failing.runBackup(), false)
    assert.equal(await failing.runRestoreDrill(), false)
    assert.equal(failing.snapshot().backupFailuresTotal, 1)
    assert.equal(failing.snapshot().drillFailuresTotal, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("runtime rejects overlapping backup and drill work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "backup-runtime-"))
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  try {
    const runtime = await BackupRuntime.open({
      statePath: join(directory, "state.json"),
      createGeneration: () => pending,
      runRestoreDrill: async () => ({ generationId: "unused" }),
    })
    const first = runtime.runBackup()
    assert.equal(await runtime.runBackup(), false)
    assert.equal(await runtime.runRestoreDrill(), false)
    release({ commit: { generationId: "generation-a" } })
    assert.equal(await first, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
