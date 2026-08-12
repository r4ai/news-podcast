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
  }).pipe(Effect.mapError(configFailure))
}
