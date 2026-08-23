import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { makeS3ReplayAccessSignerUnsafe } from "./s3-replay-access-signer.js"

const signer = makeS3ReplayAccessSignerUnsafe({
  endpoint: "https://objects.example.test",
  region: "us-east-1",
  bucket: "private",
  accessKeyId: "test-access",
  secretAccessKey: "test-secret",
})

describe("S3 replay access signer", () => {
  it("issues only a short read URL for the exact stored key and media type", async () => {
    const signed = await Effect.runPromise(
      signer.issue({
        objectKey:
          "articles/6518412b-ce2f-4641-9f2c-a02dd515bc31/replay/index.html" as never,
        mediaType: "text/html; charset=utf-8" as never,
        expiresAtEpochMillis: Date.now() + 60_000,
      })
    )
    const url = new URL(signed)

    expect(url.origin).toBe("https://objects.example.test")
    expect(url.pathname).toContain("/private/articles/")
    expect(url.searchParams.get("response-content-type")).toBe(
      "text/html; charset=utf-8"
    )
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(
      60
    )
  })

  it("rejects an already expired request", async () => {
    await expect(
      Effect.runPromise(
        signer.issue({
          objectKey: "articles/x" as never,
          mediaType: "text/html" as never,
          expiresAtEpochMillis: Date.now() - 1,
        })
      )
    ).rejects.toBeDefined()
  })
})
