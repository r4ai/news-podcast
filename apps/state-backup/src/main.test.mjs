import assert from "node:assert/strict"
import test from "node:test"

import { decodeEncryptionKey, loadConfiguration } from "./main.mjs"

const environment = {
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
  assert.equal(configuration.archive.bucket, "news-podcast-backup")
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
