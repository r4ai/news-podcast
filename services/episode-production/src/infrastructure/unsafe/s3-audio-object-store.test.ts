import {
  DeleteObjectCommand,
  type PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3"
import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"

import {
  MAX_WAV_BYTES,
  openS3AudioObjectStoreUnsafe,
  s3AudioObjectStoreScoped,
  type S3AudioObjectStoreConfig,
} from "./s3-audio-object-store.js"

const config: S3AudioObjectStoreConfig = {
  endpoint: "http://seaweedfs:8333",
  region: "us-east-1",
  bucket: "private-audio",
  accessKeyId: "access-secret-id",
  secretAccessKey: "super-secret-key",
  requestTimeoutMillis: 1_000,
}
const ids = {
  ownerId: "owner/../../unsafe" as never,
  jobId: "10e2d4e1-c127-479f-a124-2ea037bd9319" as never,
  episodeId: "6518412b-ce2f-4641-9f2c-a02dd515bc31" as never,
}

const wav = (): Uint8Array => {
  const bytes = new Uint8Array(45)
  bytes.set(Buffer.from("RIFF"), 0)
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true)
  bytes.set(Buffer.from("WAVEfmt "), 8)
  bytes.set(Buffer.from("data"), 36)
  return bytes
}

describe("S3 audio object store", () => {
  it("projects one bounded WAV into an exact service-owned PutObject", async () => {
    const bytes = wav()
    const signal = new AbortController().signal
    const close = vi.fn()
    const send = vi.fn(async (command: PutObjectCommand, options) => {
      expect(command.input).toEqual({
        Bucket: "private-audio",
        Key: "episodes/owner-safe/job-safe/episode-safe.wav",
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: "audio/wav",
      })
      expect(options.abortSignal).toBeInstanceOf(AbortSignal)
      expect(options.abortSignal.aborted).toBe(false)
      return {}
    })
    const stored = await Effect.runPromise(
      Effect.scoped(
        s3AudioObjectStoreScoped(config, {
          createClient: () => ({ client: { send } as never, close }),
          keyFor: vi.fn(() => "episodes/owner-safe/job-safe/episode-safe.wav"),
        }).pipe(Effect.flatMap((store) => store.put({ ...ids, bytes, signal })))
      )
    )

    expect(stored).toEqual({
      episodeId: ids.episodeId,
      objectKey: "episodes/owner-safe/job-safe/episode-safe.wav",
      byteLength: bytes.byteLength,
      contentType: "audio/wav",
    })
    expect(Object.isFrozen(stored)).toBe(true)
    expect(send).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it("derives a deterministic path-safe key without embedding an unsafe owner", () => {
    const resource = openS3AudioObjectStoreUnsafe(config, {
      createClient: () => ({ client: {} as S3Client, close: vi.fn() }),
    })

    expect(resource.keyFor(ids)).toMatch(
      /^episodes\/[a-f0-9]{64}\/10e2d4e1-c127-479f-a124-2ea037bd9319\/6518412b-ce2f-4641-9f2c-a02dd515bc31\.wav$/
    )
    expect(resource.keyFor(ids)).not.toContain(ids.ownerId)
    expect(resource.keyFor(ids)).not.toContain("..")
  })

  it("deletes an abandoned service-owned audio object", async () => {
    const send = vi.fn(async (command: DeleteObjectCommand) => {
      expect(command).toBeInstanceOf(DeleteObjectCommand)
      expect(command.input).toEqual({
        Bucket: "private-audio",
        Key: "episodes/owner-safe/job-safe/episode-safe.wav",
      })
      return {}
    })
    const resource = openS3AudioObjectStoreUnsafe(config, {
      createClient: () => ({ client: { send } as never, close: vi.fn() }),
    })

    await Effect.runPromise(
      resource.store.remove("episodes/owner-safe/job-safe/episode-safe.wav")
    )

    expect(send).toHaveBeenCalledOnce()
  })

  it("passes an already-aborted signal and returns only a redacted typed failure", async () => {
    const controller = new AbortController()
    controller.abort("owners/private/job")
    const send = vi.fn(() =>
      Promise.reject(
        new Error(
          `aborted ${config.secretAccessKey} owners/private/job/audio.wav`
        )
      )
    )
    const resource = openS3AudioObjectStoreUnsafe(config, {
      createClient: () => ({ client: { send } as never, close: vi.fn() }),
      keyFor: () => "episodes/safe/job/episode.wav",
    })

    const failure = await Effect.runPromise(
      resource.store
        .put({ ...ids, bytes: wav(), signal: controller.signal })
        .pipe(Effect.flip)
    )

    expect(send).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    })
    expect(failure).toEqual({
      _tag: "PipelineFailure",
      code: "audio_store_canceled",
      retryable: false,
    })
    expect(JSON.stringify(failure)).not.toContain(config.accessKeyId)
    expect(JSON.stringify(failure)).not.toContain(config.secretAccessKey)
    expect(JSON.stringify(failure)).not.toContain("owners/private")
  })

  it("redacts SDK failure details", async () => {
    const resource = openS3AudioObjectStoreUnsafe(config, {
      createClient: () => ({
        client: {
          send: () =>
            Promise.reject(
              new Error(`${config.accessKeyId}:${config.secretAccessKey}`)
            ),
        } as never,
        close: vi.fn(),
      }),
      keyFor: () => "episodes/safe/job/episode.wav",
    })

    const failure = await Effect.runPromise(
      resource.store.put({ ...ids, bytes: wav() }).pipe(Effect.flip)
    )

    expect(failure).toEqual({
      _tag: "PipelineFailure",
      code: "audio_store_unavailable",
      retryable: true,
    })
    expect(JSON.stringify(failure)).not.toContain(config.accessKeyId)
    expect(JSON.stringify(failure)).not.toContain(config.secretAccessKey)
  })

  it("aborts an Object Store upload at the configured deadline", async () => {
    const resource = openS3AudioObjectStoreUnsafe(
      { ...config, requestTimeoutMillis: 1 },
      {
        createClient: () => ({
          client: {
            send: async (
              _command: unknown,
              options: { abortSignal: AbortSignal }
            ) =>
              new Promise((_resolve, reject) =>
                options.abortSignal.addEventListener(
                  "abort",
                  () => reject(new Error("timed out")),
                  { once: true }
                )
              ),
          } as never,
          close: vi.fn(),
        }),
        keyFor: () => "episodes/safe/job/episode.wav",
      }
    )

    expect(
      await Effect.runPromise(
        Effect.flip(resource.store.put({ ...ids, bytes: wav() }))
      )
    ).toEqual({
      _tag: "PipelineFailure",
      code: "audio_store_unavailable",
      retryable: true,
    })
  })

  it.each([
    ["empty", new Uint8Array()],
    ["non-WAV", new Uint8Array(44)],
    ["oversize", new Uint8Array(MAX_WAV_BYTES + 1)],
  ])("rejects %s audio before opening an SDK request", async (_case, bytes) => {
    const send = vi.fn()
    const resource = openS3AudioObjectStoreUnsafe(config, {
      createClient: () => ({ client: { send } as never, close: vi.fn() }),
      keyFor: () => "episodes/safe/job/episode.wav",
    })

    const failure = await Effect.runPromise(
      resource.store.put({ ...ids, bytes }).pipe(Effect.flip)
    )

    expect(failure).toEqual({
      _tag: "PipelineFailure",
      code: "invalid_audio",
      retryable: false,
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("rejects an unsafe injected key before opening an SDK request", async () => {
    const send = vi.fn()
    const resource = openS3AudioObjectStoreUnsafe(config, {
      createClient: () => ({ client: { send } as never, close: vi.fn() }),
      keyFor: () => "episodes/../../credentials.wav",
    })

    const exit = await Effect.runPromiseExit(
      resource.store.put({ ...ids, bytes: wav() })
    )

    expect(exit._tag).toBe("Failure")
    expect(send).not.toHaveBeenCalled()
  })
})
