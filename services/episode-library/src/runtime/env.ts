import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import {
  parseNodeEpisodeLibraryServiceConfig,
  type NodeEpisodeLibraryRpcError,
} from "./node.js"

const configFailure = (): NodeEpisodeLibraryRpcError =>
  deepFreeze({
    _tag: "NodeEpisodeLibraryRpcFailed" as const,
    component: "Config" as const,
  })

/** Projects only service-owned runtime values; secrets never enter failures. */
export const readEpisodeLibraryConfig = (
  env: Readonly<Record<string, string | undefined>>
) => {
  const sqlitePath = env.EPISODE_LIBRARY_DATABASE_PATH?.trim() ?? ""
  if (sqlitePath === "" || sqlitePath === ":memory:") {
    return Effect.fail(configFailure())
  }

  return parseNodeEpisodeLibraryServiceConfig({
    sqlitePath,
    natsServers: (env.NATS_SERVERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    queueGroup: env.EPISODE_LIBRARY_QUEUE_GROUP?.trim() ?? "",
    completionConsumer: {
      stream: env.EPISODE_LIBRARY_COMPLETION_STREAM?.trim() ?? "",
      durableName: env.EPISODE_LIBRARY_COMPLETION_DURABLE_NAME?.trim() ?? "",
      ackWaitMillis: Number(
        env.EPISODE_LIBRARY_COMPLETION_ACK_WAIT_MILLIS ?? ""
      ),
      maximumDeliveries: Number(
        env.EPISODE_LIBRARY_COMPLETION_MAXIMUM_DELIVERIES ?? ""
      ),
      initialNackDelayMillis: Number(
        env.EPISODE_LIBRARY_COMPLETION_INITIAL_NACK_DELAY_MILLIS ?? ""
      ),
      maximumNackDelayMillis: Number(
        env.EPISODE_LIBRARY_COMPLETION_MAXIMUM_NACK_DELAY_MILLIS ?? ""
      ),
    },
    s3: {
      endpoint: env.S3_ENDPOINT?.trim() ?? "",
      region: env.S3_REGION?.trim() ?? "",
      bucket: env.S3_BUCKET?.trim() ?? "",
      accessKeyId: env.S3_ACCESS_KEY_ID?.trim() ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY?.trim() ?? "",
    },
  }).pipe(Effect.mapError(configFailure))
}
