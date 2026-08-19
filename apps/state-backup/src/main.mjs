#!/usr/bin/env node
import { S3Client } from "@aws-sdk/client-s3"
import { readFile } from "node:fs/promises"

import {
  createGeneration,
  defaultPolicy,
  runRestoreDrill,
} from "./coordinator.mjs"
import { BackupRuntime, startScheduler, startStatusServer } from "./runtime.mjs"
import {
  createImmutableArchive,
  createSourceObjectStore,
} from "./s3-storage.mjs"

const required = (environment, name) => {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const positiveInteger = (environment, name, fallback) => {
  const value = Number(environment[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

const normalizedEndpoint = (value) => new URL(value).href.replace(/\/$/, "")

const assertHttpEndpoint = (value, name) => {
  const endpoint = new URL(value)
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`)
  }
  return endpoint
}

export const loadConfiguration = (environment) => {
  const sourceEndpoint = normalizedEndpoint(
    environment.S3_ENDPOINT ?? "http://seaweedfs:8333"
  )
  const sourceBucket = environment.S3_BUCKET ?? "news-podcast"
  const archiveEndpoint = normalizedEndpoint(
    required(environment, "BACKUP_ARCHIVE_ENDPOINT")
  )
  const archiveBucket = required(environment, "BACKUP_ARCHIVE_BUCKET")
  assertHttpEndpoint(sourceEndpoint, "S3_ENDPOINT")
  const archiveUrl = assertHttpEndpoint(
    archiveEndpoint,
    "BACKUP_ARCHIVE_ENDPOINT"
  )
  if (sourceEndpoint === archiveEndpoint) {
    throw new Error(
      "backup archive must use a different endpoint from the source"
    )
  }
  if (
    ["localhost", "127.0.0.1", "::1", "seaweedfs"].includes(archiveUrl.hostname)
  ) {
    throw new Error("backup archive must be off-host")
  }
  return {
    source: {
      endpoint: sourceEndpoint,
      region: environment.S3_REGION ?? "us-east-1",
      bucket: sourceBucket,
      accessKeyId: required(environment, "S3_ACCESS_KEY_ID"),
      secretAccessKey: required(environment, "S3_SECRET_ACCESS_KEY"),
      forcePathStyle: true,
    },
    archive: {
      endpoint: archiveEndpoint,
      region: environment.BACKUP_ARCHIVE_REGION ?? "us-east-1",
      bucket: archiveBucket,
      accessKeyId: required(environment, "BACKUP_ARCHIVE_ACCESS_KEY_ID"),
      secretAccessKey: required(
        environment,
        "BACKUP_ARCHIVE_SECRET_ACCESS_KEY"
      ),
      forcePathStyle: environment.BACKUP_ARCHIVE_FORCE_PATH_STYLE === "true",
    },
    databaseSources: {
      identity:
        environment.BACKUP_IDENTITY_DATABASE ??
        "/source/identity/identity.sqlite",
      content:
        environment.BACKUP_CONTENT_DATABASE ?? "/source/content/content.sqlite",
      production:
        environment.BACKUP_PRODUCTION_DATABASE ??
        "/source/production/production.sqlite",
      library:
        environment.BACKUP_LIBRARY_DATABASE ?? "/source/library/library.sqlite",
    },
    encryptionKeyFile: required(environment, "BACKUP_ENCRYPTION_KEY_FILE"),
    statePath:
      environment.BACKUP_STATE_PATH ??
      "/var/lib/news-podcast-backup/state.json",
    stagingRoot:
      environment.BACKUP_STAGING_ROOT ?? "/var/lib/news-podcast-backup/staging",
    port: positiveInteger(environment, "BACKUP_PORT", 4198),
    backupIntervalMs: positiveInteger(
      environment,
      "BACKUP_INTERVAL_MS",
      86_400_000
    ),
    drillIntervalMs: positiveInteger(
      environment,
      "BACKUP_DRILL_INTERVAL_MS",
      604_800_000
    ),
    policy: {
      rpoHours: positiveInteger(environment, "BACKUP_RPO_HOURS", 24),
      rtoHours: positiveInteger(environment, "BACKUP_RTO_HOURS", 4),
      retainedGenerations: positiveInteger(
        environment,
        "BACKUP_RETAINED_GENERATIONS",
        30
      ),
      immutableDays: positiveInteger(environment, "BACKUP_IMMUTABLE_DAYS", 35),
    },
  }
}

export const decodeEncryptionKey = (secret) => {
  const value = secret.trim()
  const key = /^[\da-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64")
  if (key.byteLength !== 32) {
    throw new Error(
      "backup encryption secret must be 32 bytes as hex or base64"
    )
  }
  return key
}

const s3Client = (configuration) =>
  new S3Client({
    endpoint: configuration.endpoint,
    region: configuration.region,
    forcePathStyle: configuration.forcePathStyle,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
  })

const main = async () => {
  const configuration = loadConfiguration(process.env)
  const encryptionKey = decodeEncryptionKey(
    await readFile(configuration.encryptionKeyFile, "utf8")
  )
  const sourceClient = s3Client(configuration.source)
  const archiveClient = s3Client(configuration.archive)
  const sourceObjects = createSourceObjectStore({
    client: sourceClient,
    bucket: configuration.source.bucket,
  })
  const archive = createImmutableArchive({
    client: archiveClient,
    bucket: configuration.archive.bucket,
  })
  await archive.assertImmutable()

  const common = {
    archive,
    encryptionKey,
    stagingRoot: configuration.stagingRoot,
  }
  const runtime = await BackupRuntime.open({
    statePath: configuration.statePath,
    createGeneration: () =>
      createGeneration({
        ...common,
        databaseSources: configuration.databaseSources,
        sourceObjects,
        policy: { ...defaultPolicy, ...configuration.policy },
      }),
    runRestoreDrill: () => runRestoreDrill(common),
  })
  const server = startStatusServer(runtime, configuration.port)
  const controller = new AbortController()
  startScheduler({
    runtime,
    backupIntervalMs: configuration.backupIntervalMs,
    drillIntervalMs: configuration.drillIntervalMs,
    signal: controller.signal,
  })

  const stop = () => {
    controller.abort()
    server.close(() => {
      sourceClient.destroy()
      archiveClient.destroy()
      process.exit(0)
    })
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
}

if (import.meta.filename === process.argv[1]) {
  void main().catch((error) => {
    console.error(
      JSON.stringify({
        event: "backup.startup.failed",
        error: error instanceof Error ? error.message : String(error),
      })
    )
    process.exitCode = 1
  })
}
