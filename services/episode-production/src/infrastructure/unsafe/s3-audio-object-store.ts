import { createHash } from "node:crypto"

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { deepFreeze, type DeepReadonly } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  AudioObjectStore,
  PipelineFailure,
} from "../../application/ports/execution.js"
import type { EpisodeId, JobId, OwnerId } from "../../domain/episode-job.js"
import { parsePlayableWave } from "../../application/wave.js"

export const MAX_WAV_BYTES = 128 * 1_024 * 1_024

export type S3AudioObjectStoreConfig = DeepReadonly<{
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly requestTimeoutMillis: number
}>

type AudioObjectIdentity = Readonly<{
  readonly ownerId: OwnerId
  readonly jobId: JobId
  readonly episodeId: EpisodeId
}>

type UnsafeS3ClientResource = Readonly<{
  readonly client: S3Client
  readonly close: () => void
}>

export type S3AudioObjectStoreDependencies = Readonly<{
  readonly createClient: (
    config: S3AudioObjectStoreConfig
  ) => UnsafeS3ClientResource
  readonly keyFor: (identity: AudioObjectIdentity) => string
}>

export type S3AudioObjectStoreResource = Readonly<{
  readonly store: AudioObjectStore
  readonly keyFor: (identity: AudioObjectIdentity) => string
  readonly close: Effect.Effect<void>
}>

const pipelineFailure = (
  code:
    | "audio_store_canceled"
    | "audio_store_unavailable"
    | "audio_delete_unavailable"
    | "invalid_audio",
  retryable: boolean
): PipelineFailure =>
  deepFreeze({ _tag: "PipelineFailure" as const, code, retryable })

const defaultKeyFor = (identity: AudioObjectIdentity): string => {
  const ownerPartition = createHash("sha256")
    .update(identity.ownerId)
    .digest("hex")
  return `episodes/${ownerPartition}/${identity.jobId}/${identity.episodeId}.wav`
}

const defaultDependencies: S3AudioObjectStoreDependencies = Object.freeze({
  createClient: (config) => {
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
    return Object.freeze({ client, close: () => client.destroy() })
  },
  keyFor: defaultKeyFor,
})

const isBoundedWav = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_WAV_BYTES) return false
  return parsePlayableWave(bytes) !== undefined
}

const SAFE_KEY =
  /^episodes\/[a-z0-9][a-z0-9-]{0,127}\/[a-z0-9][a-z0-9-]{0,127}\/[a-z0-9][a-z0-9-]{0,127}\.wav$/

/** Confines mutable AWS SDK state and exception detail to the unsafe boundary. */
export const openS3AudioObjectStoreUnsafe = (
  config: S3AudioObjectStoreConfig,
  dependencies: Partial<S3AudioObjectStoreDependencies> = defaultDependencies
): S3AudioObjectStoreResource => {
  const createClient =
    dependencies.createClient ?? defaultDependencies.createClient
  const keyFor = dependencies.keyFor ?? defaultDependencies.keyFor
  const resource = createClient(config)
  const store: AudioObjectStore = Object.freeze({
    put: (input) => {
      if (!isBoundedWav(input.bytes)) {
        return Effect.fail(pipelineFailure("invalid_audio", false))
      }
      const objectKey = keyFor(input)
      if (objectKey.length > 512 || !SAFE_KEY.test(objectKey)) {
        return Effect.fail(pipelineFailure("invalid_audio", false))
      }

      return Effect.tryPromise({
        try: async (effectSignal) => {
          const timeout = new AbortController()
          const timer = setTimeout(
            () => timeout.abort(),
            config.requestTimeoutMillis
          )
          timer.unref()
          const abortSignal = AbortSignal.any([
            effectSignal,
            timeout.signal,
            ...(input.signal === undefined ? [] : [input.signal]),
          ])
          try {
            return await resource.client.send(
              new PutObjectCommand({
                Bucket: config.bucket,
                Key: objectKey,
                Body: input.bytes,
                ContentLength: input.bytes.byteLength,
                ContentType: "audio/wav",
              }),
              { abortSignal }
            )
          } finally {
            clearTimeout(timer)
          }
        },
        catch: () =>
          input.signal?.aborted === true
            ? pipelineFailure("audio_store_canceled", false)
            : pipelineFailure("audio_store_unavailable", true),
      }).pipe(
        Effect.as(
          deepFreeze({
            episodeId: input.episodeId,
            objectKey,
            byteLength: input.bytes.byteLength,
            contentType: "audio/wav" as const,
          })
        )
      )
    },
    remove: (objectKey) => {
      if (objectKey.length > 512 || !SAFE_KEY.test(objectKey)) {
        return Effect.fail(pipelineFailure("invalid_audio", false))
      }
      return Effect.tryPromise({
        try: async (effectSignal) => {
          const timeout = new AbortController()
          const timer = setTimeout(
            () => timeout.abort(),
            config.requestTimeoutMillis
          )
          timer.unref()
          try {
            await resource.client.send(
              new DeleteObjectCommand({
                Bucket: config.bucket,
                Key: objectKey,
              }),
              {
                abortSignal: AbortSignal.any([effectSignal, timeout.signal]),
              }
            )
          } finally {
            clearTimeout(timer)
          }
        },
        catch: () => pipelineFailure("audio_delete_unavailable", true),
      })
    },
  })

  return Object.freeze({
    store,
    keyFor,
    close: Effect.try({ try: resource.close, catch: () => undefined }).pipe(
      Effect.ignore
    ),
  })
}

/** Provides the audio port while binding the SDK client to an Effect scope. */
export const s3AudioObjectStoreScoped = (
  config: S3AudioObjectStoreConfig,
  dependencies: Partial<S3AudioObjectStoreDependencies> = defaultDependencies
) =>
  Effect.acquireRelease(
    Effect.sync(() => openS3AudioObjectStoreUnsafe(config, dependencies)),
    (resource) => resource.close
  ).pipe(Effect.map((resource) => resource.store))
