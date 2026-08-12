import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"

import { parseNodeServiceConfig, type NodeRuntimeError } from "./node.js"

const configFailure = (): NodeRuntimeError =>
  deepFreeze({
    _tag: "ContentKnowledgeRuntimeFailed" as const,
    component: "Config" as const,
  })

const decimalInteger = (value: string | undefined): number =>
  value !== undefined && /^(?:0|[1-9]\d*)$/.test(value.trim())
    ? Number(value)
    : Number.NaN

/** Reads only explicitly owned variables and rejects malformed values. */
export const readContentKnowledgeConfig = (
  env: Readonly<Record<string, string | undefined>>
) => {
  const sqlitePath = env.CONTENT_KNOWLEDGE_DATABASE_PATH?.trim() ?? ""
  const natsServers = (env.NATS_SERVERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  if (sqlitePath === "" || sqlitePath === ":memory:") {
    return Effect.fail(configFailure())
  }

  return parseNodeServiceConfig({
    sqlitePath,
    natsServers,
    relay: {
      batchSize: decimalInteger(env.CONTENT_OUTBOX_BATCH_SIZE),
      intervalMillis: decimalInteger(env.CONTENT_OUTBOX_INTERVAL_MS),
      initialBackoffMillis: decimalInteger(
        env.CONTENT_OUTBOX_INITIAL_BACKOFF_MS
      ),
      maximumBackoffMillis: decimalInteger(env.CONTENT_OUTBOX_MAX_BACKOFF_MS),
    },
    rpc: {
      queueGroup: env.CONTENT_RPC_QUEUE_GROUP?.trim() ?? "",
    },
    feedPoller: {
      http: {
        timeoutMillis: decimalInteger(env.CONTENT_RSS_TIMEOUT_MS),
        maximumBytes: decimalInteger(env.CONTENT_RSS_MAX_BYTES),
      },
      loop: {
        intervalMillis: decimalInteger(env.CONTENT_RSS_INTERVAL_MS),
        initialBackoffMillis: decimalInteger(
          env.CONTENT_RSS_INITIAL_BACKOFF_MS
        ),
        maximumBackoffMillis: decimalInteger(env.CONTENT_RSS_MAX_BACKOFF_MS),
      },
    },
    archive: {
      endpoint: env.S3_ENDPOINT?.trim() ?? "",
      region: env.S3_REGION?.trim() ?? "",
      bucket: env.S3_BUCKET?.trim() ?? "",
      accessKeyId: env.S3_ACCESS_KEY_ID?.trim() ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY?.trim() ?? "",
      timeoutMillis: decimalInteger(env.CONTENT_ARCHIVE_TIMEOUT_MS),
      maximumHtmlBytes: decimalInteger(env.CONTENT_ARCHIVE_MAX_HTML_BYTES),
    },
  }).pipe(Effect.mapError(configFailure))
}
