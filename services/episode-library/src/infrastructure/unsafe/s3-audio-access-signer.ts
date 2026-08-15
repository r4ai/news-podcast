import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { deepFreeze, type DeepReadonly, parse } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  AudioAccessSigner,
  AudioAccessSigningFailure,
} from "../../application/ports/episode-library.js"
import { HttpUrlSchema } from "../../domain/episode.js"

export type S3AudioAccessSignerConfig = DeepReadonly<{
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
}>

export type UnsafeS3SignerClient = Readonly<{
  readonly client: S3Client
  readonly close: () => void
}>

export type S3AudioAccessSignerDependencies = Readonly<{
  readonly createClient: (
    config: S3AudioAccessSignerConfig
  ) => UnsafeS3SignerClient
  readonly presign: typeof getSignedUrl
  readonly nowEpochMillis: () => number
}>

export type S3AudioAccessSignerResource = DeepReadonly<{
  readonly signer: AudioAccessSigner
  readonly close: Effect.Effect<void>
}>

const signingFailure = (): AudioAccessSigningFailure =>
  deepFreeze({ _tag: "AudioAccessSigningFailure" as const })

const defaultDependencies: S3AudioAccessSignerDependencies = Object.freeze({
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
  presign: getSignedUrl,
  nowEpochMillis: Date.now,
})

/** AWS SDK mutation and errors stay in this unsafe adapter. */
export const openS3AudioAccessSignerUnsafe = (
  config: S3AudioAccessSignerConfig,
  dependencies: S3AudioAccessSignerDependencies = defaultDependencies
): S3AudioAccessSignerResource => {
  const resource = dependencies.createClient(config)
  const signer: AudioAccessSigner = {
    issue: (input) => {
      const remainingMillis =
        input.expiresAtEpochMillis - dependencies.nowEpochMillis()
      if (remainingMillis <= 0) return Effect.fail(signingFailure())

      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: input.objectKey,
        ResponseContentType: input.contentType,
      })
      return Effect.tryPromise({
        try: () =>
          dependencies.presign(resource.client, command, {
            expiresIn: Math.ceil(remainingMillis / 1_000),
          }),
        catch: signingFailure,
      }).pipe(
        Effect.flatMap(parse(HttpUrlSchema)),
        Effect.mapError(signingFailure)
      )
    },
  }

  return deepFreeze({
    signer,
    close: Effect.try({ try: resource.close, catch: signingFailure }).pipe(
      Effect.ignore
    ),
  })
}
