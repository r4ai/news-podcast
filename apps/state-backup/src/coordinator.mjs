import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto"
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import { basename, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { pipeline } from "node:stream/promises"

import {
  assertHealthyDatabase,
  backupDatabase,
  serviceProfiles,
} from "../../../scripts/sqlite-state.mjs"
import {
  assertCrossServiceState,
  databaseProfiles as profiles,
  rejectGeneration,
  withSqliteWriteBarrier,
} from "./consistency.mjs"

export {
  assertCrossServiceState,
  withSqliteWriteBarrier,
} from "./consistency.mjs"

const encryptionMagic = Buffer.from("NPBK1")
const nonceBytes = 12
const tagBytes = 16

export const defaultPolicy = Object.freeze({
  rpoHours: 24,
  rtoHours: 4,
  retainedGenerations: 30,
  immutableDays: 35,
})

const fail = (message) => {
  throw new Error(message)
}

const assertEncryptionKey = (key) => {
  if (!Buffer.isBuffer(key) || key.byteLength !== 32) {
    fail("backup encryption key must be exactly 32 bytes")
  }
}

const assertGenerationId = (generationId) => {
  if (!/^[\w.-]{1,128}$/.test(generationId)) fail("invalid generation id")
}

const sha256 = (input) => createHash("sha256").update(input).digest("hex")

const sha256File = async (path) => {
  const hash = createHash("sha256")
  await pipeline(createReadStream(path), hash)
  return hash.digest("hex")
}

const fileSize = async (path) => (await stat(path)).size

const encryptFile = async (source, destination, key) => {
  const nonce = randomBytes(nonceBytes)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  await writeFile(destination, Buffer.concat([encryptionMagic, nonce]))
  await pipeline(
    createReadStream(source),
    cipher,
    createWriteStream(destination, { flags: "a" })
  )
  await appendFile(destination, cipher.getAuthTag())
}

const decryptFile = async (source, destination, key) => {
  const descriptor = await open(source, "r")
  try {
    const { size } = await descriptor.stat()
    const minimumSize = encryptionMagic.byteLength + nonceBytes + tagBytes
    if (size < minimumSize) fail("encrypted backup artifact is truncated")
    const header = Buffer.alloc(encryptionMagic.byteLength + nonceBytes)
    await descriptor.read(header, 0, header.byteLength, 0)
    if (
      !header.subarray(0, encryptionMagic.byteLength).equals(encryptionMagic)
    ) {
      fail("encrypted backup artifact has an invalid header")
    }
    const tag = Buffer.alloc(tagBytes)
    await descriptor.read(tag, 0, tagBytes, size - tagBytes)
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(encryptionMagic.byteLength)
    )
    decipher.setAuthTag(tag)
    await pipeline(
      createReadStream(source, {
        start: header.byteLength,
        end: size - tagBytes - 1,
      }),
      decipher,
      createWriteStream(destination)
    )
  } finally {
    await descriptor.close()
  }
}

const databaseSchemaVersion = (path) => {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    return Number(
      database.prepare("PRAGMA user_version").get()?.user_version ?? 0
    )
  } finally {
    database.close()
  }
}

const listArticleReferences = (path) => {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const references = []
    const rows = database
      .prepare("SELECT snapshot_json FROM article_snapshots")
      .all()
    for (const row of rows) {
      let snapshot
      try {
        snapshot = JSON.parse(row.snapshot_json)
      } catch {
        fail("article snapshot contains invalid JSON")
      }
      const capture = snapshot?.capture
      const artifacts = [
        capture?.rawResponse,
        capture?.replay,
        capture?.markdown,
        ...(Array.isArray(capture?.assets) ? capture.assets : []),
      ]
      for (const artifact of artifacts) {
        if (typeof artifact?.key !== "string" || artifact.key.length === 0) {
          fail("article snapshot contains an invalid object reference")
        }
        references.push({
          kind: "article",
          key: artifact.key,
          expectedSha256:
            typeof artifact.sha256 === "string" ? artifact.sha256 : undefined,
          expectedSize:
            Number.isSafeInteger(artifact.byteLength) &&
            artifact.byteLength >= 0
              ? artifact.byteLength
              : undefined,
        })
      }
    }
    return references
  } finally {
    database.close()
  }
}

const listEpisodeReferences = (path) => {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const columns = new Set(
      database
        .prepare("PRAGMA table_info(episodes)")
        .all()
        .map((row) => row.name)
    )
    const sizeColumn = columns.has("audio_byte_length")
      ? ", audio_byte_length"
      : ""
    return database
      .prepare(`SELECT audio_object_key${sizeColumn} FROM episodes`)
      .all()
      .map((row) => ({
        kind: "episode",
        key: row.audio_object_key,
        expectedSize: Number.isSafeInteger(row.audio_byte_length)
          ? row.audio_byte_length
          : undefined,
      }))
  } finally {
    database.close()
  }
}

const durableReferences = (databasePaths) => [
  ...listArticleReferences(databasePaths.content),
  ...listEpisodeReferences(databasePaths.library),
]

const assertReferences = (references, objectEntries) => {
  const byKey = new Map(objectEntries.map((entry) => [entry.key, entry]))
  for (const reference of references) {
    const object = byKey.get(reference.key)
    if (!object) fail(`referenced object is missing: ${reference.key}`)
    if (
      reference.expectedSha256 !== undefined &&
      reference.expectedSha256 !== object.sha256
    ) {
      fail(`referenced object hash differs: ${reference.key}`)
    }
    if (
      reference.expectedSize !== undefined &&
      reference.expectedSize !== object.size
    ) {
      fail(`referenced object size differs: ${reference.key}`)
    }
  }
}

const generationPrefix = (generationId) => `generations/${generationId}`

const writeJson = (path, value) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`)

const uploadEncrypted = async ({
  archive,
  source,
  encrypted,
  key,
  archiveKey,
  retainUntil,
}) => {
  await encryptFile(source, encrypted, key)
  await archive.putImmutableFile(archiveKey, encrypted, {
    contentType: "application/octet-stream",
    retainUntil,
  })
}

const normalizeObjectListing = (objects) => {
  const listedObjects = [...objects].toSorted((a, b) =>
    String(a.key).localeCompare(String(b.key))
  )
  const seenKeys = new Set()
  for (const object of listedObjects) {
    if (
      typeof object.key !== "string" ||
      object.key.length === 0 ||
      object.key.startsWith("/") ||
      object.key.split("/").some((part) => part === "..") ||
      typeof object.etag !== "string" ||
      object.etag.length === 0 ||
      !Number.isSafeInteger(object.size) ||
      object.size < 0
    ) {
      rejectGeneration(
        "object_inventory_invalid",
        "source object listing contains an invalid entry"
      )
    }
    if (seenKeys.has(object.key)) {
      rejectGeneration(
        "object_inventory_invalid",
        `duplicate source object: ${object.key}`
      )
    }
    seenKeys.add(object.key)
  }
  return listedObjects
}

const objectInventoryFingerprint = (objects) =>
  sha256(
    objects
      .map(({ key, etag, size }) => `${key}\0${etag ?? ""}\0${size ?? ""}`)
      .join("\n")
  )

export const createGeneration = async ({
  databaseSources,
  sourceObjects,
  archive,
  encryptionKey,
  stagingRoot,
  createdAt = new Date(),
  generationId = `${createdAt.toISOString().replaceAll(/[-:.]/g, "")}-${randomUUID()}`,
  policy = defaultPolicy,
  barrierTimeoutMillis = 30_000,
  writeBarrier = withSqliteWriteBarrier,
  snapshotDatabase = backupDatabase,
  validateCrossServiceState = assertCrossServiceState,
}) => {
  assertEncryptionKey(encryptionKey)
  assertGenerationId(generationId)
  const effectivePolicy = { ...defaultPolicy, ...policy }
  const prefix = generationPrefix(generationId)
  const staging = join(stagingRoot, `generation-${generationId}`)
  const databaseDirectory = join(staging, "databases")
  const objectDirectory = join(staging, "objects")
  const encryptedDirectory = join(staging, "encrypted")
  const retainUntil = new Date(
    createdAt.getTime() + effectivePolicy.immutableDays * 86_400_000
  )
  await mkdir(databaseDirectory, { recursive: true })
  await mkdir(objectDirectory, { recursive: true })
  await mkdir(encryptedDirectory, { recursive: true })

  try {
    const boundary = await writeBarrier({
      databaseSources,
      timeoutMillis: barrierTimeoutMillis,
      operation: async () => {
        const databaseEntries = []
        const databaseBackups = {}
        for (const profile of profiles) {
          const source = databaseSources?.[profile]
          if (typeof source !== "string") {
            fail(`missing ${profile} database source`)
          }
          const destination = join(databaseDirectory, `${profile}.sqlite`)
          await snapshotDatabase(profile, source, destination)
          databaseBackups[profile] = destination
          const archiveKey = `${prefix}/databases/${profile}.sqlite.enc`
          databaseEntries.push({
            profile,
            archiveKey,
            sha256: await sha256File(destination),
            size: await fileSize(destination),
            schemaUserVersion: databaseSchemaVersion(destination),
            requiredTables: serviceProfiles[profile],
          })
        }

        const firstListing = normalizeObjectListing(
          await sourceObjects.listObjects()
        )
        const secondListing = normalizeObjectListing(
          await sourceObjects.listObjects()
        )
        const sourceGeneration = objectInventoryFingerprint(firstListing)
        if (sourceGeneration !== objectInventoryFingerprint(secondListing)) {
          rejectGeneration(
            "object_inventory_changed",
            "source object inventory changed inside the backup barrier"
          )
        }
        validateCrossServiceState(databaseBackups)
        return {
          databaseEntries,
          databaseBackups,
          listedObjects: firstListing,
          sourceGeneration,
        }
      },
    })
    const {
      databaseEntries,
      databaseBackups,
      listedObjects,
      sourceGeneration,
    } = boundary.value

    const objectEntries = []
    for (const object of listedObjects) {
      const identity = sha256(object.key)
      const path = join(objectDirectory, identity)
      const downloaded = await sourceObjects.downloadObject(object.key, path)
      const actualSize = await fileSize(path)
      if (
        (Number.isSafeInteger(object.size) && object.size !== actualSize) ||
        (downloaded?.etag !== undefined &&
          object.etag !== undefined &&
          downloaded.etag !== object.etag) ||
        (Number.isSafeInteger(downloaded?.size) &&
          downloaded.size !== actualSize)
      ) {
        rejectGeneration(
          "object_changed_after_barrier",
          `source object changed while backing up: ${object.key}`
        )
      }
      objectEntries.push({
        key: object.key,
        etag: object.etag ?? null,
        size: actualSize,
        sha256: await sha256File(path),
        archiveKey: `${prefix}/objects/${identity}.enc`,
        stagingPath: path,
      })
    }

    const references = durableReferences(databaseBackups)
    assertReferences(references, objectEntries)
    const articleArchiveObjects = references.filter(
      ({ kind }) => kind === "article"
    ).length
    const episodeAudioObjects = references.filter(
      ({ kind }) => kind === "episode"
    ).length
    for (const entry of databaseEntries) {
      await uploadEncrypted({
        archive,
        source: databaseBackups[entry.profile],
        encrypted: join(encryptedDirectory, `${entry.profile}.sqlite.enc`),
        key: encryptionKey,
        archiveKey: entry.archiveKey,
        retainUntil,
      })
    }
    for (const entry of objectEntries) {
      await uploadEncrypted({
        archive,
        source: entry.stagingPath,
        encrypted: join(encryptedDirectory, `${basename(entry.archiveKey)}`),
        key: encryptionKey,
        archiveKey: entry.archiveKey,
        retainUntil,
      })
    }

    const manifest = {
      schemaVersion: 2,
      generationId,
      createdAt: createdAt.toISOString(),
      policy: effectivePolicy,
      encryption: { algorithm: "AES-256-GCM", format: "NPBK1" },
      consistency: {
        strategy: "sqlite-write-barrier",
        barrierDurationMillis: boundary.durationMillis,
        objectInventory: "double-listed-inside-barrier",
        crossServiceInvariant: "production-completion-v1",
      },
      databases: databaseEntries,
      objects: {
        sourceGeneration,
        entries: objectEntries.map(({ stagingPath: _, ...entry }) => entry),
      },
      references: { articleArchiveObjects, episodeAudioObjects },
    }
    const manifestPath = join(staging, "manifest.json")
    const encryptedManifestPath = join(encryptedDirectory, "manifest.json.enc")
    const manifestKey = `${prefix}/manifest.json.enc`
    await writeJson(manifestPath, manifest)
    await uploadEncrypted({
      archive,
      source: manifestPath,
      encrypted: encryptedManifestPath,
      key: encryptionKey,
      archiveKey: manifestKey,
      retainUntil,
    })

    const commit = {
      schemaVersion: 2,
      generationId,
      createdAt: createdAt.toISOString(),
      state: "committed",
      manifestKey,
      manifestCipherSha256: await sha256File(encryptedManifestPath),
    }
    const commitPath = join(staging, "commit.json")
    await writeJson(commitPath, commit)
    await archive.putImmutableFile(`${prefix}/commit.json`, commitPath, {
      contentType: "application/json",
      retainUntil,
    })
    return { manifest, commit }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

const parseCommitGeneration = (key) => {
  const match = /^generations\/([\w.-]{1,128})\/commit\.json$/.exec(key)
  return match?.[1]
}

export const runRestoreDrill = async ({
  archive,
  encryptionKey,
  stagingRoot,
}) => {
  assertEncryptionKey(encryptionKey)
  const commitKeys = (await archive.listCommitKeys()).toSorted()
  const commitKey = commitKeys.at(-1)
  if (!commitKey) fail("no committed backup generation exists")
  const generationId = parseCommitGeneration(commitKey)
  if (!generationId) fail("archive returned an invalid commit key")
  const staging = join(stagingRoot, `restore-drill-${generationId}`)
  await mkdir(staging, { recursive: true })
  try {
    const commitPath = join(staging, "commit.json")
    await archive.downloadFile(commitKey, commitPath)
    const commit = JSON.parse(await readFile(commitPath, "utf8"))
    if (commit.state !== "committed" || commit.generationId !== generationId) {
      fail("backup commit marker is invalid")
    }
    const encryptedManifestPath = join(staging, "manifest.json.enc")
    await archive.downloadFile(commit.manifestKey, encryptedManifestPath)
    if (
      (await sha256File(encryptedManifestPath)) !== commit.manifestCipherSha256
    ) {
      fail("encrypted backup manifest hash differs")
    }
    const manifestPath = join(staging, "manifest.json")
    await decryptFile(encryptedManifestPath, manifestPath, encryptionKey)
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    if (manifest.generationId !== generationId) {
      fail("backup manifest generation differs from commit")
    }

    const restoredDatabases = {}
    for (const entry of manifest.databases) {
      const encrypted = join(staging, `${entry.profile}.sqlite.enc`)
      const restored = join(staging, `${entry.profile}.sqlite`)
      await archive.downloadFile(entry.archiveKey, encrypted)
      await decryptFile(encrypted, restored, encryptionKey)
      if ((await sha256File(restored)) !== entry.sha256) {
        fail(`restored database hash differs: ${entry.profile}`)
      }
      assertHealthyDatabase(restored, entry.profile)
      restoredDatabases[entry.profile] = restored
    }
    assertCrossServiceState(restoredDatabases)

    const restoredObjects = []
    for (const entry of manifest.objects.entries) {
      const identity = sha256(entry.key)
      const encrypted = join(staging, `${identity}.enc`)
      const restored = join(staging, identity)
      await archive.downloadFile(entry.archiveKey, encrypted)
      await decryptFile(encrypted, restored, encryptionKey)
      const restoredEntry = {
        ...entry,
        size: await fileSize(restored),
        sha256: await sha256File(restored),
      }
      if (
        restoredEntry.sha256 !== entry.sha256 ||
        restoredEntry.size !== entry.size
      ) {
        fail(`restored object differs: ${entry.key}`)
      }
      restoredObjects.push(restoredEntry)
    }
    const references = durableReferences(restoredDatabases)
    assertReferences(references, restoredObjects)
    return {
      generationId,
      databases: manifest.databases.length,
      objects: restoredObjects.length,
      articleArchiveObjects: references.filter(({ kind }) => kind === "article")
        .length,
      episodeAudioObjects: references.filter(({ kind }) => kind === "episode")
        .length,
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
