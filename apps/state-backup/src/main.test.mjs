import assert from "node:assert/strict"
import test from "node:test"

import { decodeEncryptionKey, loadConfiguration } from "./main.mjs"

const environment = {
  BACKUP_TARGET_ATTESTATION_FILE: "/run/secrets/backup-target-attestation",
  S3_ACCESS_KEY_ID: "source-key",
  S3_SECRET_ACCESS_KEY: "source-secret",
  BACKUP_ARCHIVE_ENDPOINT: "https://backup.example.invalid",
  BACKUP_ARCHIVE_BUCKET: "news-podcast-backup",
  BACKUP_ARCHIVE_ACCESS_KEY_ID: "archive-key",
  BACKUP_ARCHIVE_SECRET_ACCESS_KEY: "archive-secret",
  BACKUP_ENCRYPTION_KEY_FILE: "/run/secrets/backup-encryption-key",
}

test("configuration fixes the documented durability policy and distinct destination", () => {
  const configuration = loadConfiguration(environment)
  assert.deepEqual(configuration.policy, {
    rpoHours: 24,
    rtoHours: 4,
    retainedGenerations: 30,
    immutableDays: 35,
  })
  assert.equal(configuration.backupIntervalMs, 86_400_000)
  assert.equal(configuration.drillIntervalMs, 604_800_000)
  assert.equal(configuration.barrierTimeoutMillis, 30_000)
  assert.equal(configuration.archive.bucket, "news-podcast-backup")
})

test("configuration bounds the SQLite write barrier timeout", () => {
  assert.equal(
    loadConfiguration({
      ...environment,
      BACKUP_BARRIER_TIMEOUT_MS: "45000",
    }).barrierTimeoutMillis,
    45_000
  )
  assert.throws(
    () =>
      loadConfiguration({
        ...environment,
        BACKUP_BARRIER_TIMEOUT_MS: "120001",
      }),
    /BACKUP_BARRIER_TIMEOUT_MS must be at most 120000/
  )
})

test("configuration refuses to back up into the live source bucket", () => {
  assert.throws(
    () =>
      loadConfiguration({
        ...environment,
        S3_ENDPOINT: "https://same.example.invalid",
        S3_BUCKET: "same",
        BACKUP_ARCHIVE_ENDPOINT: "https://same.example.invalid/",
        BACKUP_ARCHIVE_BUCKET: "different-bucket",
      }),
    /must use a different endpoint/
  )
})

test("configuration refuses a loopback archive destination", () => {
  assert.throws(
    () =>
      loadConfiguration({
        ...environment,
        BACKUP_ARCHIVE_ENDPOINT: "http://127.0.0.1:9000",
      }),
    /must be off-host/
  )
})

test("encryption key accepts exactly 32 bytes encoded as hex or base64", () => {
  assert.equal(decodeEncryptionKey("ab".repeat(32)).byteLength, 32)
  assert.equal(
    decodeEncryptionKey(Buffer.alloc(32, 1).toString("base64")).byteLength,
    32
  )
  assert.throws(() => decodeEncryptionKey("short"), /must be 32 bytes/)
})

test("configuration refuses an alias-only independence claim without target attestation", () => {
  assert.throws(
    () =>
      loadConfiguration({
        ...environment,
        BACKUP_TARGET_ATTESTATION_FILE: undefined,
        S3_ENDPOINT: "https://storage.internal",
        S3_BUCKET: "news-podcast",
        BACKUP_ARCHIVE_ENDPOINT: "https://storage-alias.internal",
        BACKUP_ARCHIVE_BUCKET: "news-podcast",
      }),
    /BACKUP_TARGET_ATTESTATION_FILE is required/
  )
})

test("configuration refuses bracketed IPv6 loopback and credential reuse", () => {
  assert.throws(
    () =>
      loadConfiguration({
        ...environment,
        BACKUP_ARCHIVE_ENDPOINT: "http://[::1]:9000",
      }),
    /must be off-host/
  )
  assert.throws(
    () =>
      loadConfiguration({
        ...environment,
        BACKUP_ARCHIVE_ACCESS_KEY_ID: environment.S3_ACCESS_KEY_ID,
        BACKUP_ARCHIVE_SECRET_ACCESS_KEY: environment.S3_SECRET_ACCESS_KEY,
      }),
    /credentials must be distinct/
  )
})

for (const endpoint of [
  "http://localhost.:9000",
  "http://127.1:9000",
  "http://0x7f000001:9000",
  "http://[::ffff:127.0.0.1]:9000",
]) {
  test(`rejects alternate loopback spelling ${endpoint}`, () => {
    assert.throws(
      () =>
        loadConfiguration({
          ...environment,
          BACKUP_ARCHIVE_ENDPOINT: endpoint,
        }),
      /must be off-host/
    )
  })
}

test("legacy environment can generate unapproved identity JSON without exposing secrets", async () => {
  const { execFileSync } = await import("node:child_process")
  const output = execFileSync(
    process.execPath,
    [new URL("./target-identity-template.mjs", import.meta.url).pathname],
    {
      env: { ...environment, BACKUP_TARGET_ATTESTATION_FILE: undefined },
      encoding: "utf8",
    }
  )
  const document = JSON.parse(output)
  assert.equal(document.approval.archiveCannotModifySource, false)
  assert.equal(document.approval.sourceCannotModifyArchive, false)
  assert.equal(document.source.forcePathStyle, true)
  assert.equal(document.archive.accountId, "")
  assert.ok(!output.includes(environment.S3_SECRET_ACCESS_KEY))
  assert.ok(!output.includes(environment.BACKUP_ARCHIVE_SECRET_ACCESS_KEY))
})
