import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import test from "node:test"

import {
  createImmutableArchive,
  createSourceObjectStore,
} from "./s3-storage.mjs"

test("source adapter snapshots every paginated object and downloads its body", async () => {
  const calls = []
  const requestOptions = []
  const client = {
    async send(command, options) {
      calls.push(command)
      requestOptions.push(options)
      if (command.constructor.name === "ListObjectsV2Command") {
        return command.input.ContinuationToken
          ? {
              Contents: [{ Key: "b", Size: 2, ETag: '"etag-b"' }],
              IsTruncated: false,
            }
          : {
              Contents: [{ Key: "a", Size: 1, ETag: '"etag-a"' }],
              IsTruncated: true,
              NextContinuationToken: "next",
            }
      }
      return {
        Body: Readable.from([Buffer.from("body")]),
        ETag: '"etag-a"',
        ContentLength: 4,
      }
    },
  }
  const directory = await mkdtemp(join(tmpdir(), "backup-s3-"))
  try {
    const source = createSourceObjectStore({ client, bucket: "source" })
    const controller = new AbortController()
    assert.deepEqual(await source.listObjects({ signal: controller.signal }), [
      { key: "a", size: 1, etag: "etag-a" },
      { key: "b", size: 2, etag: "etag-b" },
    ])
    assert.equal(requestOptions[0]?.abortSignal, controller.signal)
    assert.equal(requestOptions[1]?.abortSignal, controller.signal)
    const destination = join(directory, "object")
    assert.deepEqual(await source.downloadObject("a", destination), {
      etag: "etag-a",
      size: 4,
    })
    assert.equal(await readFile(destination, "utf8"), "body")
    assert.equal(calls.at(-1).constructor.name, "GetObjectCommand")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("archive requires versioning and Object Lock and writes immutable COMPLIANCE objects", async () => {
  const calls = []
  const client = {
    async send(command) {
      calls.push(command)
      if (command.constructor.name === "GetBucketVersioningCommand") {
        return { Status: "Enabled" }
      }
      if (command.constructor.name === "GetObjectLockConfigurationCommand") {
        return { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled" } }
      }
      if (command.constructor.name === "ListObjectsV2Command") {
        return {
          Contents: [
            { Key: "generations/a/database.enc" },
            { Key: "generations/a/commit.json" },
          ],
          IsTruncated: false,
        }
      }
      return {}
    },
  }
  const directory = await mkdtemp(join(tmpdir(), "backup-s3-"))
  try {
    const archive = createImmutableArchive({ client, bucket: "archive" })
    await archive.assertImmutable()
    const path = join(directory, "artifact")
    await writeFile(path, "encrypted")
    const retainUntil = new Date("2026-09-24T00:00:00.000Z")
    await archive.putImmutableFile("generations/a/database.enc", path, {
      contentType: "application/octet-stream",
      retainUntil,
    })
    assert.deepEqual(await archive.listCommitKeys(), [
      "generations/a/commit.json",
    ])
    const put = calls.find(
      ({ constructor }) => constructor.name === "PutObjectCommand"
    )
    assert.equal(put.input.IfNoneMatch, "*")
    assert.equal(put.input.ObjectLockMode, "COMPLIANCE")
    assert.equal(put.input.ObjectLockRetainUntilDate, retainUntil)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("archive rejects a destination without Object Lock", async () => {
  const archive = createImmutableArchive({
    bucket: "archive",
    client: {
      async send(command) {
        return command.constructor.name === "GetBucketVersioningCommand"
          ? { Status: "Enabled" }
          : { ObjectLockConfiguration: { ObjectLockEnabled: "Disabled" } }
      },
    },
  })
  await assert.rejects(archive.assertImmutable(), /Object Lock must be enabled/)
})
