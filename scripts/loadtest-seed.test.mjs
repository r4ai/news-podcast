import { mkdtemp, stat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  validateDistinctOwners,
  writeSessionFixture,
} from "./loadtest-seed.mjs"

test("seed requires at least two distinct owners", () => {
  assert.throws(
    () =>
      validateDistinctOwners([{ ownerId: "owner-a" }, { ownerId: "owner-a" }]),
    /at least two sessions with distinct ownerId values/
  )
  assert.doesNotThrow(() =>
    validateDistinctOwners([{ ownerId: "owner-a" }, { ownerId: "owner-b" }])
  )
})

test("session fixture is written with owner data and mode 0600", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "loadtest-seed-"))
  const outputPath = path.join(directory, "sessions.json")
  try {
    await writeSessionFixture(outputPath, [
      {
        cookie: "better-auth.session_token=secret",
        ownerId: "owner-a",
        articleIds: ["article-a"],
        jobIds: ["job-a"],
        episodeIds: ["episode-a"],
      },
    ])
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
