import {
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, stat } from "node:fs/promises"
import { dirname } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

const fail = (message) => {
  throw new Error(message)
}

const download = async (client, bucket, key, destination) => {
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  )
  if (!result.Body) fail(`S3 object has no body: ${key}`)
  await mkdir(dirname(destination), { recursive: true })
  const body =
    result.Body instanceof Readable
      ? result.Body
      : Readable.fromWeb(result.Body.transformToWebStream())
  await pipeline(body, createWriteStream(destination))
  return {
    etag: result.ETag?.replaceAll('"', ""),
    size: result.ContentLength,
  }
}

const listAll = async (client, input) => {
  const contents = []
  let continuationToken
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        ...input,
        ContinuationToken: continuationToken,
      })
    )
    contents.push(...(page.Contents ?? []))
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined
    if (page.IsTruncated && !continuationToken) {
      fail("S3 listing was truncated without a continuation token")
    }
  } while (continuationToken)
  return contents
}

export const createSourceObjectStore = ({ client, bucket }) => ({
  async listObjects() {
    const objects = await listAll(client, { Bucket: bucket })
    return objects.map((object) => {
      if (typeof object.Key !== "string") fail("S3 listing contains no key")
      return {
        key: object.Key,
        size: object.Size,
        etag: object.ETag?.replaceAll('"', ""),
      }
    })
  },
  downloadObject: (key, destination) =>
    download(client, bucket, key, destination),
})

export const createImmutableArchive = ({ client, bucket }) => ({
  async assertImmutable() {
    const versioning = await client.send(
      new GetBucketVersioningCommand({ Bucket: bucket })
    )
    if (versioning.Status !== "Enabled") {
      fail("archive bucket versioning must be enabled")
    }
    const lock = await client.send(
      new GetObjectLockConfigurationCommand({ Bucket: bucket })
    )
    if (lock.ObjectLockConfiguration?.ObjectLockEnabled !== "Enabled") {
      fail("archive bucket Object Lock must be enabled")
    }
  },
  async putImmutableFile(key, path, { contentType, retainUntil }) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: (await stat(path)).size,
        ContentType: contentType,
        IfNoneMatch: "*",
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: retainUntil,
      })
    )
  },
  downloadFile: (key, destination) =>
    download(client, bucket, key, destination),
  async listCommitKeys() {
    const objects = await listAll(client, {
      Bucket: bucket,
      Prefix: "generations/",
    })
    return objects
      .map(({ Key }) => Key)
      .filter((key) => typeof key === "string" && key.endsWith("/commit.json"))
      .toSorted()
  },
})
