import { deepFreeze } from "@news-podcast/kernel"
import { Effect } from "effect"
import { readProviderRuntimeMode } from "@news-podcast/service-runtime"

import { parseNodeServiceConfig, type NodeRuntimeError } from "./node.js"

const configFailure = (): NodeRuntimeError =>
  deepFreeze({
    _tag: "ContentKnowledgeRuntimeFailed" as const,
    component: "Config" as const,
  })

const decimalInteger = (
  value: string | undefined,
  fallback?: number
): number => {
  if (value === undefined && fallback !== undefined) return fallback
  return value !== undefined && /^(?:0|[1-9]\d*)$/.test(value.trim())
    ? Number(value)
    : Number.NaN
}

const boolean = (
  value: string | undefined,
  fallback: boolean
): boolean | "invalid" => {
  if (value === undefined || value.trim() === "") return fallback
  if (value === "true") return true
  if (value === "false") return false
  return "invalid"
}

/** Reads only explicitly owned variables and rejects malformed values. */
export const readContentKnowledgeConfig = (
  env: Readonly<Record<string, string | undefined>>
) => {
  const resetDailyEnabled = boolean(env.CONTENT_ENRICH_RESET_ENABLED, false)
  const sqlitePath = env.CONTENT_KNOWLEDGE_DATABASE_PATH?.trim() ?? ""
  const natsServers = (env.NATS_SERVERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const openAiApiKey = env.OPENAI_API_KEY?.trim() ?? ""
  const openAiModel =
    env.CONTENT_ENRICH_OPENAI_MODEL?.trim() || env.OPENAI_MODEL?.trim() || ""
  if (sqlitePath === "" || sqlitePath === ":memory:") {
    return Effect.fail(configFailure())
  }

  return readProviderRuntimeMode(env).pipe(
    Effect.flatMap((providerRuntime) =>
      parseNodeServiceConfig({
        appEnvironment: providerRuntime.appEnvironment,
        sqlitePath,
        natsServers,
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
            maximumBackoffMillis: decimalInteger(
              env.CONTENT_RSS_MAX_BACKOFF_MS
            ),
          },
        },
        enrichment: {
          dailyLimit: decimalInteger(env.CONTENT_ENRICH_DAILY_LIMIT),
          resetDailyEnabled,
          provider:
            providerRuntime.providerMode === "live"
              ? {
                  apiUrl:
                    env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1",
                  apiKey: openAiApiKey,
                  model: openAiModel,
                  requestTimeoutMillis: decimalInteger(
                    env.CONTENT_ENRICH_OPENAI_TIMEOUT_MS,
                    60_000
                  ),
                  maximumAttempts: decimalInteger(
                    env.CONTENT_ENRICH_OPENAI_MAX_ATTEMPTS,
                    3
                  ),
                  baseDelayMillis: decimalInteger(
                    env.CONTENT_ENRICH_OPENAI_BASE_DELAY_MS,
                    1_000
                  ),
                  maximumDelayMillis: decimalInteger(
                    env.CONTENT_ENRICH_OPENAI_MAX_DELAY_MS,
                    30_000
                  ),
                }
              : null,
          loop: {
            intervalMillis: decimalInteger(env.CONTENT_ENRICH_INTERVAL_MS),
            initialBackoffMillis: decimalInteger(
              env.CONTENT_ENRICH_INITIAL_BACKOFF_MS
            ),
            maximumBackoffMillis: decimalInteger(
              env.CONTENT_ENRICH_MAX_BACKOFF_MS
            ),
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
          maximumAssetBytes: decimalInteger(
            env.CONTENT_ARCHIVE_MAX_ASSET_BYTES,
            20 * 1_024 * 1_024
          ),
          maximumAssetCount: decimalInteger(
            env.CONTENT_ARCHIVE_MAX_ASSET_COUNT,
            512
          ),
          maximumAssetTotalBytes: decimalInteger(
            env.CONTENT_ARCHIVE_MAX_ASSET_TOTAL_BYTES,
            100 * 1_024 * 1_024
          ),
          cleanup: {
            intervalMillis: decimalInteger(
              env.CONTENT_ARCHIVE_CLEANUP_INTERVAL_MS,
              6 * 60 * 60 * 1_000
            ),
            retentionMillis: decimalInteger(
              env.CONTENT_ARCHIVE_ORPHAN_RETENTION_MS,
              24 * 60 * 60 * 1_000
            ),
          },
        },
      })
    ),
    Effect.mapError(configFailure)
  )
}
