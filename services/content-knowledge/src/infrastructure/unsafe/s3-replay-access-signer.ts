import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import type {
  ReplayAccessSigner,
  ReplayAccessSigningFailure,
} from "../../application/article-library.js"

type Config = Readonly<{
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}>

const failure = (): ReplayAccessSigningFailure =>
  deepFreeze({ _tag: "ReplayAccessSigningFailure" })

/** Issues a one-minute, read-only URL; object keys and credentials stay server-side. */
export const makeS3ReplayAccessSignerUnsafe = (
  config: Config
): ReplayAccessSigner => {
  return {
    issue: (input) => {
      const remainingMillis = input.expiresAtEpochMillis - Date.now()
      if (remainingMillis <= 0) return Effect.fail(failure())
      const client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      })
      return Effect.tryPromise({
        try: () =>
          getSignedUrl(
            client,
            new GetObjectCommand({
              Bucket: config.bucket,
              Key: input.objectKey,
              ResponseContentType: input.mediaType,
            }),
            { expiresIn: Math.ceil(remainingMillis / 1_000) }
          ),
        catch: failure,
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            client.destroy()
          })
        )
      )
    },
  }
}
