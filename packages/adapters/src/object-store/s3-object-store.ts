import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"

import type { ObjectStore, StoredObject } from "@news-podcast/application"
import type { S3Config } from "../config.js"

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint.href,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  async put(input: {
    readonly key: string
    readonly body: Uint8Array
    readonly contentType: string
    readonly signal?: AbortSignal
  }): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentLength: input.body.byteLength,
        ContentType: input.contentType,
      }),
      input.signal ? { abortSignal: input.signal } : undefined
    )
    return {
      key: input.key,
      byteLength: input.body.byteLength,
      contentType: input.contentType,
    }
  }

  async get(key: string, signal?: AbortSignal) {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
        signal ? { abortSignal: signal } : undefined
      )
      if (!response.Body) return null
      const body = await response.Body.transformToByteArray()
      return {
        body,
        contentType: response.ContentType ?? "application/octet-stream",
        byteLength: response.ContentLength ?? body.byteLength,
      }
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode
      if (status === 404) return null
      throw error
    }
  }

  async delete(key: string, signal?: AbortSignal): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      signal ? { abortSignal: signal } : undefined
    )
  }
}
