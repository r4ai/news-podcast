import { randomUUID } from "node:crypto"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

const live = process.env.PROVIDER_CONTRACT_REFRESH === "1"

describe.runIf(live)("SeaweedFS 4.21 live adapter contract", () => {
  it("round-trips one isolated object and proves cleanup", async () => {
    const endpoint = process.env.S3_ENDPOINT
    const bucket = process.env.S3_BUCKET
    const accessKeyId = process.env.S3_ACCESS_KEY_ID
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
      throw new Error("SeaweedFS contract configuration is incomplete")

    const client = new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    })
    const key = `_contract-tests/${randomUUID()}.bin`
    const expected = new TextEncoder().encode("provider-contract-probe")
    try {
      const put = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: expected,
          ContentType: "application/octet-stream",
        })
      )
      const head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      )
      const get = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      )
      expect(put.$metadata.httpStatusCode).toBe(200)
      expect(head.$metadata.httpStatusCode).toBe(200)
      expect(get.$metadata.httpStatusCode).toBe(200)
      expect(head.ContentType).toBe("application/octet-stream")
      expect(head.ContentLength).toBe(expected.byteLength)
      expect(await get.Body?.transformToByteArray()).toEqual(expected)

      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      await expect(
        client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
    } finally {
      await client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        .catch(() => undefined)
      client.destroy()
    }
  })
})
