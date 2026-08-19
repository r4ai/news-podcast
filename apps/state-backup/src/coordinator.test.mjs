import assert from "node:assert/strict"
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { createGeneration, runRestoreDrill } from "./coordinator.mjs"

const encryptionKey = Buffer.alloc(32, 7)
const createdAt = new Date("2026-08-20T00:00:00.000Z")

const createDatabase = (path, profile) => {
  const database = new DatabaseSync(path)
  if (profile === "identity") {
    database.exec("CREATE TABLE user_settings(owner_id TEXT PRIMARY KEY)")
  } else if (profile === "content") {
    database.exec(`
      CREATE TABLE feed_subscriptions(subscription_id TEXT PRIMARY KEY);
      CREATE TABLE article_snapshots(snapshot_json TEXT NOT NULL);
    `)
    database
      .prepare("INSERT INTO article_snapshots(snapshot_json) VALUES (?)")
      .run(
        JSON.stringify({
          capture: {
            rawResponse: { key: "articles/a/raw.html" },
            replay: { key: "articles/a/replay.html" },
            markdown: { key: "articles/a/article.md" },
            assets: [{ key: "articles/a/logo.png" }],
          },
        })
      )
  } else if (profile === "production") {
    database.exec("CREATE TABLE episode_jobs(job_id TEXT PRIMARY KEY)")
  } else {
    database.exec(
      "CREATE TABLE episodes(id TEXT PRIMARY KEY, audio_object_key TEXT NOT NULL)"
    )
    database
      .prepare("INSERT INTO episodes(id, audio_object_key) VALUES (?, ?)")
      .run("episode-a", "episodes/a/audio.mp3")
  }
  database.close()
}

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "coordinated-backup-"))
  const databaseSources = {}
  for (const profile of ["identity", "content", "production", "library"]) {
    const path = join(directory, `${profile}.sqlite`)
    createDatabase(path, profile)
    databaseSources[profile] = path
  }
  const objects = new Map([
    ["articles/a/raw.html", Buffer.from("raw")],
    ["articles/a/replay.html", Buffer.from("replay")],
    ["articles/a/article.md", Buffer.from("markdown")],
    ["articles/a/logo.png", Buffer.from("logo")],
    ["episodes/a/audio.mp3", Buffer.from("audio")],
    ["unreferenced/retained.txt", Buffer.from("retained")],
  ])
  const sourceObjects = {
    async listObjects() {
      return [...objects].map(([key, body], index) => ({
        key,
        size: body.byteLength,
        etag: `etag-${index}`,
      }))
    },
    async downloadObject(key, destination) {
      const body = objects.get(key)
      if (!body) throw new Error(`missing source object: ${key}`)
      await mkdir(join(destination, ".."), { recursive: true })
      await writeFile(destination, body)
    },
  }
  const uploads = new Map()
  const archive = {
    async putImmutableFile(key, path) {
      if (uploads.has(key)) throw new Error(`immutable object exists: ${key}`)
      uploads.set(key, await readFile(path))
    },
    async downloadFile(key, destination) {
      const body = uploads.get(key)
      if (!body) throw new Error(`missing archive object: ${key}`)
      await writeFile(destination, body)
    },
    async listCommitKeys() {
      return [...uploads.keys()].filter((key) => key.endsWith("/commit.json"))
    },
  }
  return {
    directory,
    databaseSources,
    objects,
    sourceObjects,
    uploads,
    archive,
  }
}

test("commits one encrypted generation only after all four databases and objects validate", async () => {
  const fixture = await setup()
  try {
    const result = await createGeneration({
      databaseSources: fixture.databaseSources,
      sourceObjects: fixture.sourceObjects,
      archive: fixture.archive,
      encryptionKey,
      stagingRoot: fixture.directory,
      createdAt,
      generationId: "20260820T000000000Z-test",
      policy: {
        rpoHours: 24,
        rtoHours: 4,
        retainedGenerations: 30,
        immutableDays: 35,
      },
    })

    assert.deepEqual(
      result.manifest.databases.map(({ profile }) => profile),
      ["identity", "content", "production", "library"]
    )
    assert.equal(result.manifest.objects.entries.length, fixture.objects.size)
    assert.match(result.manifest.objects.sourceGeneration, /^[a-f\d]{64}$/)
    assert.deepEqual(result.manifest.references, {
      articleArchiveObjects: 4,
      episodeAudioObjects: 1,
    })
    assert.equal(result.manifest.encryption.algorithm, "AES-256-GCM")
    assert.equal(
      fixture.uploads.has("generations/20260820T000000000Z-test/commit.json"),
      true
    )
    assert.equal(
      fixture.uploads
        .get("generations/20260820T000000000Z-test/manifest.json.enc")
        ?.includes(Buffer.from('"databases"')),
      false,
      "the remote manifest must not expose plaintext state"
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("a missing referenced article object leaves no success marker", async () => {
  const fixture = await setup()
  fixture.objects.delete("articles/a/article.md")
  try {
    await assert.rejects(
      createGeneration({
        databaseSources: fixture.databaseSources,
        sourceObjects: fixture.sourceObjects,
        archive: fixture.archive,
        encryptionKey,
        stagingRoot: fixture.directory,
        createdAt,
        generationId: "20260820T000000000Z-partial",
      }),
      /referenced object is missing: articles\/a\/article\.md/
    )
    assert.equal(
      [...fixture.uploads.keys()].some((key) => key.endsWith("/commit.json")),
      false
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("an object changed after inventory listing leaves no success marker", async () => {
  const fixture = await setup()
  fixture.sourceObjects.downloadObject = async (key, destination) => {
    await writeFile(destination, fixture.objects.get(key))
    return {
      etag: "changed-after-list",
      size: fixture.objects.get(key).byteLength,
    }
  }
  try {
    await assert.rejects(
      createGeneration({
        databaseSources: fixture.databaseSources,
        sourceObjects: fixture.sourceObjects,
        archive: fixture.archive,
        encryptionKey,
        stagingRoot: fixture.directory,
        createdAt,
        generationId: "20260820T000000000Z-raced",
      }),
      /source object changed while backing up/
    )
    assert.equal(
      [...fixture.uploads.keys()].some((key) => key.endsWith("/commit.json")),
      false
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("restore drill decrypts the latest committed generation and checks every durable reference", async () => {
  const fixture = await setup()
  try {
    await createGeneration({
      databaseSources: fixture.databaseSources,
      sourceObjects: fixture.sourceObjects,
      archive: fixture.archive,
      encryptionKey,
      stagingRoot: fixture.directory,
      createdAt,
      generationId: "20260820T000000000Z-drill",
    })

    const result = await runRestoreDrill({
      archive: fixture.archive,
      encryptionKey,
      stagingRoot: fixture.directory,
    })

    assert.deepEqual(result, {
      generationId: "20260820T000000000Z-drill",
      databases: 4,
      objects: 6,
      articleArchiveObjects: 4,
      episodeAudioObjects: 1,
    })
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})
