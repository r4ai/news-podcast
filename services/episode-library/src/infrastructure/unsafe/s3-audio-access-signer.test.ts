import type { S3Client } from "@aws-sdk/client-s3"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  openS3AudioAccessSignerUnsafe,
  type S3AudioAccessSignerConfig,
} from "./s3-audio-access-signer.js"

const config: S3AudioAccessSignerConfig = {
  endpoint: "http://seaweedfs:8333",
  region: "us-east-1",
  bucket: "private-audio",
  accessKeyId: "access-secret-id",
  secretAccessKey: "super-secret-key",
}

describe("S3-compatible audio access signer", () => {
  it("presigns the requested bucket/key and closes its client", async () => {
    const close = vi.fn()
    const client = {} as S3Client
    const presign = vi.fn(async (_client, command, options) => {
      expect(command.input).toEqual({
        Bucket: "private-audio",
        Key: "owners/u/episodes/e/audio.wav",
        ResponseContentType: "audio/wav",
      })
      expect(options).toEqual({ expiresIn: 300 })
      return "https://audio.test/private?X-Amz-Signature=opaque"
    })
    const resource = openS3AudioAccessSignerUnsafe(config, {
      createClient: vi.fn(() => ({ client, close })),
      presign,
      nowEpochMillis: () => 1_000,
    })

    const url = await Effect.runPromise(
      resource.signer.issue({
        objectKey: "owners/u/episodes/e/audio.wav" as never,
        contentType: "audio/wav",
        expiresAtEpochMillis: 301_000,
      })
    )
    await Effect.runPromise(resource.close)

    expect(url).toBe("https://audio.test/private?X-Amz-Signature=opaque")
    expect(presign).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    [
      "SDK failure",
      () =>
        Promise.reject(
          new Error(`denied ${config.secretAccessKey} owners/secret.wav`)
        ),
    ],
    [
      "invalid returned URL",
      () => Promise.resolve("file:///owners/secret.wav"),
    ],
  ])("redacts credentials and object keys on %s", async (_case, presign) => {
    const resource = openS3AudioAccessSignerUnsafe(config, {
      createClient: () => ({ client: {} as S3Client, close: vi.fn() }),
      presign,
      nowEpochMillis: () => 1_000,
    })

    const failure = await Effect.runPromise(
      resource.signer
        .issue({
          objectKey: "owners/secret.wav" as never,
          contentType: "audio/wav",
          expiresAtEpochMillis: 301_000,
        })
        .pipe(Effect.flip)
    )

    expect(failure).toEqual({ _tag: "AudioAccessSigningFailure" })
    expect(JSON.stringify(failure)).not.toContain(config.accessKeyId)
    expect(JSON.stringify(failure)).not.toContain(config.secretAccessKey)
    expect(JSON.stringify(failure)).not.toContain("owners/secret.wav")
  })

  it("rejects already-expired access without calling the SDK", async () => {
    const presign = vi.fn()
    const resource = openS3AudioAccessSignerUnsafe(config, {
      createClient: () => ({ client: {} as S3Client, close: vi.fn() }),
      presign,
      nowEpochMillis: () => 302_000,
    })

    const exit = await Effect.runPromiseExit(
      resource.signer.issue({
        objectKey: "owners/u/audio.wav" as never,
        contentType: "audio/wav",
        expiresAtEpochMillis: 301_000,
      })
    )

    expect(exit._tag).toBe("Failure")
    expect(presign).not.toHaveBeenCalled()
  })
})
