import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  assertCrossServiceState,
  createGeneration,
  runRestoreDrill,
  withSqliteWriteBarrier,
} from "./coordinator.mjs"
import { backupDatabase } from "../../../scripts/sqlite-state.mjs"

const encryptionKey = Buffer.alloc(32, 7)
const createdAt = new Date("2026-08-20T00:00:00.000Z")

const completion = (jobId, episodeId) => ({
  messageId: jobId,
  correlationId: jobId,
  causationId: jobId,
  occurredAt: "2026-08-20T00:00:00.000Z",
  producer: "episode-production",
  actor: { _tag: "Service", service: "episode-production" },
  payload: {
    episodeId,
    ownerId: "owner-a",
    title: `Episode ${episodeId}`,
    script: `Script ${episodeId}`,
    audio: {
      objectKey: "episodes/a/audio.mp3",
      byteLength: 5,
      contentType: "audio/mpeg",
    },
    sources: [
      {
        sourceKind: "rss",
        articleId: "article-a",
        snapshotId: "snapshot-a",
        url: "https://example.com/article-a",
        title: "Article A",
        publishedAt: "2026-08-19T00:00:00.000Z",
      },
    ],
    completedAt: "2026-08-20T00:00:00.000Z",
  },
})

const completionHash = (envelope) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        id: envelope.payload.episodeId,
        ownerId: envelope.payload.ownerId,
        title: envelope.payload.title,
        script: envelope.payload.script,
        audio: envelope.payload.audio,
        sources: envelope.payload.sources.map((source) => ({
          _tag: "RssSource",
          ...(source.articleId === undefined
            ? {}
            : { articleId: source.articleId }),
          url: source.url,
          title: source.title,
          ...(source.publishedAt === undefined
            ? {}
            : { publishedAt: source.publishedAt }),
          snapshotId: source.snapshotId,
        })),
        createdAt: envelope.payload.completedAt,
      })
    )
    .digest("hex")

const createDatabase = (path, profile) => {
  const database = new DatabaseSync(path)
  database.exec("PRAGMA journal_mode = WAL")
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
    database.exec(`
      CREATE TABLE episode_jobs(
        job_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        episode_id TEXT,
        completed_at TEXT
      );
      CREATE TABLE episode_completion_outbox(
        job_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        published_at TEXT
      );
    `)
    const envelope = completion("job-a", "episode-a")
    database
      .prepare(
        "INSERT INTO episode_jobs(job_id, status, episode_id, completed_at) VALUES (?, 'Succeeded', ?, ?)"
      )
      .run("job-a", "episode-a", envelope.payload.completedAt)
    database
      .prepare(
        "INSERT INTO episode_completion_outbox(job_id, episode_id, payload, published_at) VALUES (?, ?, ?, ?)"
      )
      .run(
        "job-a",
        "episode-a",
        JSON.stringify(envelope),
        createdAt.toISOString()
      )
  } else {
    database.exec(`
      CREATE TABLE episode_completion_inbox(
        message_id TEXT PRIMARY KEY,
        episode_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE TABLE episodes(
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        script TEXT NOT NULL,
        audio_object_key TEXT NOT NULL,
        audio_byte_length INTEGER NOT NULL,
        audio_content_type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE episode_sources(
        episode_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        source_kind TEXT NOT NULL,
        article_id TEXT,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        published_at TEXT,
        snapshot_id TEXT,
        PRIMARY KEY (episode_id, position)
      );
    `)
    const envelope = completion("job-a", "episode-a")
    database
      .prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        envelope.payload.episodeId,
        envelope.payload.ownerId,
        envelope.payload.title,
        envelope.payload.script,
        envelope.payload.audio.objectKey,
        envelope.payload.audio.byteLength,
        envelope.payload.audio.contentType,
        envelope.payload.completedAt
      )
    for (const [position, source] of envelope.payload.sources.entries()) {
      database
        .prepare(
          "INSERT INTO episode_sources VALUES (?, ?, 'rss', ?, ?, ?, ?, ?)"
        )
        .run(
          envelope.payload.episodeId,
          position,
          source.articleId ?? null,
          source.url,
          source.title,
          source.publishedAt ?? null,
          source.snapshotId
        )
    }
    database
      .prepare("INSERT INTO episode_completion_inbox VALUES (?, ?, ?, ?)")
      .run(
        envelope.messageId,
        envelope.payload.episodeId,
        completionHash(envelope),
        createdAt.toISOString()
      )
  }
  database.close()
}

const noWriteBarrier = async ({ operation }) => ({
  value: await operation(),
  durationMillis: 0,
})

const insertCompletedRace = (databaseSources) => {
  const envelope = completion("job-race", "episode-race")
  const production = new DatabaseSync(databaseSources.production)
  production
    .prepare(
      "UPDATE episode_jobs SET status = 'Succeeded', episode_id = ?, completed_at = ? WHERE job_id = ?"
    )
    .run(
      envelope.payload.episodeId,
      envelope.payload.completedAt,
      envelope.messageId
    )
  production
    .prepare(
      "INSERT INTO episode_completion_outbox(job_id, episode_id, payload, published_at) VALUES (?, ?, ?, ?)"
    )
    .run(
      envelope.messageId,
      envelope.payload.episodeId,
      JSON.stringify(envelope),
      createdAt.toISOString()
    )
  production.close()

  const library = new DatabaseSync(databaseSources.library)
  library
    .prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      envelope.payload.episodeId,
      envelope.payload.ownerId,
      envelope.payload.title,
      envelope.payload.script,
      envelope.payload.audio.objectKey,
      envelope.payload.audio.byteLength,
      envelope.payload.audio.contentType,
      envelope.payload.completedAt
    )
  for (const [position, source] of envelope.payload.sources.entries()) {
    library
      .prepare(
        "INSERT INTO episode_sources VALUES (?, ?, 'rss', ?, ?, ?, ?, ?)"
      )
      .run(
        envelope.payload.episodeId,
        position,
        source.articleId ?? null,
        source.url,
        source.title,
        source.publishedAt ?? null,
        source.snapshotId
      )
  }
  library
    .prepare("INSERT INTO episode_completion_inbox VALUES (?, ?, ?, ?)")
    .run(
      envelope.messageId,
      envelope.payload.episodeId,
      completionHash(envelope),
      createdAt.toISOString()
    )
  library.close()
}

test("holds a write barrier across all four SQLite databases", async () => {
  const fixture = await setup()
  try {
    const writes = {
      identity: "INSERT INTO user_settings(owner_id) VALUES ('blocked')",
      content:
        "INSERT INTO feed_subscriptions(subscription_id) VALUES ('blocked')",
      production:
        "INSERT INTO episode_jobs(job_id, status) VALUES ('blocked', 'Queued')",
      library:
        "INSERT INTO episodes VALUES ('blocked', 'owner', 'title', 'script', 'key', 1, 'audio/mpeg', '2026-08-20T00:00:00.000Z')",
    }

    const result = await withSqliteWriteBarrier({
      databaseSources: fixture.databaseSources,
      timeoutMillis: 100,
      operation: async () => {
        for (const [profile, path] of Object.entries(fixture.databaseSources)) {
          const writer = new DatabaseSync(path)
          writer.exec("PRAGMA busy_timeout = 1")
          assert.throws(() => writer.exec(writes[profile]), /busy|locked/i)
          writer.close()
        }
        return "consistent-cut"
      },
    })

    assert.equal(result.value, "consistent-cut")
    assert.equal(result.durationMillis >= 0, true)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("rejects a Library Episode whose payload differs from its inbox", async () => {
  const fixture = await setup()
  try {
    const library = new DatabaseSync(fixture.databaseSources.library)
    library
      .prepare("UPDATE episodes SET title = 'corrupted' WHERE id = 'episode-a'")
      .run()
    library.close()

    assert.throws(
      () => assertCrossServiceState(fixture.databaseSources),
      /Library Episode payload differs/
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

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
    assert.equal(result.manifest.schemaVersion, 2)
    assert.equal(
      Number.isSafeInteger(result.manifest.consistency.barrierDurationMillis),
      true
    )
    assert.deepEqual(result.manifest.consistency, {
      strategy: "sqlite-write-barrier",
      barrierDurationMillis: result.manifest.consistency.barrierDurationMillis,
      objectInventory: "double-listed-inside-barrier",
      crossServiceInvariant: "production-completion-v1",
    })
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

test("an object inventory change inside the barrier leaves no success marker", async () => {
  const fixture = await setup()
  let listings = 0
  const listObjects = fixture.sourceObjects.listObjects
  fixture.sourceObjects.listObjects = async () => {
    listings += 1
    if (listings === 2) {
      fixture.objects.set("concurrent/new.txt", Buffer.from("new"))
    }
    return listObjects()
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
        generationId: "20260820T000000000Z-inventory-race",
      }),
      /object inventory changed inside the backup barrier/
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

test("rejects a completion committed between the Production and Library snapshots", async () => {
  const fixture = await setup()
  const production = new DatabaseSync(fixture.databaseSources.production)
  production
    .prepare(
      "INSERT INTO episode_jobs(job_id, status) VALUES ('job-race', 'Running')"
    )
    .run()
  production.close()
  let raced = false
  try {
    await assert.rejects(
      createGeneration({
        databaseSources: fixture.databaseSources,
        sourceObjects: fixture.sourceObjects,
        archive: fixture.archive,
        encryptionKey,
        stagingRoot: fixture.directory,
        createdAt,
        generationId: "20260820T000000000Z-forward-skew",
        writeBarrier: noWriteBarrier,
        snapshotDatabase: async (profile, source, destination) => {
          await backupDatabase(profile, source, destination)
          if (profile === "production") {
            insertCompletedRace(fixture.databaseSources)
            raced = true
          }
        },
      }),
      /cross-service invariant.*job-race/i
    )
    assert.equal(raced, true)
    assert.equal(
      [...fixture.uploads.keys()].some((key) => key.endsWith("/commit.json")),
      false
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("restore drill rejects a legacy generation with forward completion skew", async () => {
  const fixture = await setup()
  const production = new DatabaseSync(fixture.databaseSources.production)
  production
    .prepare(
      "INSERT INTO episode_jobs(job_id, status) VALUES ('job-race', 'Running')"
    )
    .run()
  production.close()
  try {
    await createGeneration({
      databaseSources: fixture.databaseSources,
      sourceObjects: fixture.sourceObjects,
      archive: fixture.archive,
      encryptionKey,
      stagingRoot: fixture.directory,
      createdAt,
      generationId: "20260820T000000000Z-legacy-skew",
      writeBarrier: noWriteBarrier,
      validateCrossServiceState() {},
      snapshotDatabase: async (profile, source, destination) => {
        await backupDatabase(profile, source, destination)
        if (profile === "production") {
          insertCompletedRace(fixture.databaseSources)
        }
      },
    })

    await assert.rejects(
      runRestoreDrill({
        archive: fixture.archive,
        encryptionKey,
        stagingRoot: fixture.directory,
      }),
      /cross-service invariant.*job-race/i
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})
